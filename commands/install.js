/**
 * Install command
 * @module commands/install
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const argvParser = require('argv');

/**
 * Command class
 */
class Install {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Runner} runner           Runner service
     * @param {Ini} ini                 Ini service
     */
    constructor(app, config, runner, ini) {
        this._app = app;
        this._config = config;
        this._runner = runner;
        this._ini = ini;
    }

    /**
     * Service name is 'commands.install'
     * @type {string}
     */
    static get provides() {
        return 'commands.install';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'runner', 'ini' ];
    }

    /**
     * Run the command
     * @param {string[]} argv           Arguments
     * @return {Promise}
     */
    run(argv) {
        let args = argvParser
            .option({
                name: 'help',
                short: 'h',
                type: 'boolean',
            })
            .run(argv);

        return this.install()
            .then(() => {
                process.exit(0);
            })
            .catch(error => {
                return this.error(error);
            });
    }

    /**
     * Install bhid
     * @return {Promise}
     */
    install() {
        return Promise.resolve()
            .then(() => {
                let configDir;
                if (os.platform() === 'freebsd') {
                    configDir = '/usr/local/etc/bhid';
                    this._app.debug(`Platform: FreeBSD`).catch(() => { /* do nothing */ });
                } else {
                    configDir = '/etc/bhid';
                    this._app.debug(`Platform: Linux`).catch(() => { /* do nothing */ });
                }

                try {
                    fs.accessSync(configDir, fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync(configDir, 0o750);
                    } catch (error) {
                        return this.error(`Could not create ${configDir}`);
                    }
                }
                try {
                    fs.accessSync(path.join(configDir, 'id'), fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync(path.join(configDir, 'id'), 0o750);
                    } catch (error) {
                        return this.error(`Could not create ${path.join(configDir, 'id')}`);
                    }
                }
                try {
                    fs.accessSync(path.join(configDir, 'peers'), fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync(path.join(configDir, 'peers'), 0o755);
                    } catch (error) {
                        return this.error(`Could not create ${path.join(configDir, 'peers')}`);
                    }
                }
                try {
                    fs.accessSync(path.join(configDir, 'certs'), fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync(path.join(configDir, 'certs'), 0o755);
                    } catch (error) {
                        return this.error(`Could not create ${path.join(configDir, 'certs')}`);
                    }
                }
                try {
                    fs.accessSync('/var/run/bhid', fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync('/var/run/bhid', 0o755);
                    } catch (error) {
                        return this.error(`Could not create /var/run/bhid`);
                    }
                }
                try {
                    fs.accessSync('/var/log/bhid', fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync('/var/log/bhid', 0o755);
                    } catch (error) {
                        return this.error(`Could not create /var/log/bhid`);
                    }
                }

                let configExists = false;
                try {
                    this._app.debug('Creating default config').catch(() => { /* do nothing */ });
                    fs.accessSync(path.join(configDir, 'bhid.conf'), fs.constants.F_OK);
                    configExists = true;
                } catch (error) {
                    try {
                        let config = fs.readFileSync(path.join(__dirname, '..', 'bhid.conf'), { encoding: 'utf8'});
                        fs.writeFileSync(path.join(configDir, 'bhid.conf'), config, { mode: 0o640 });
                    } catch (error) {
                        return this.error(`Could not create bhid.conf`);
                    }
                }
                if (configExists) {
                    let contents = fs.readFileSync(path.join(configDir, 'bhid.conf'), { encoding: 'utf8' });
                    let parsed = [], needsConverting = false;
                    for (let line of contents.split('\n')) {
                        if (/^\s*\[.+\]\s*/.test(line)) {
                            if (line.indexOf('\\') !== -1)
                                needsConverting = true;
                            line = line.replace(/\\\./g, '.').replace(/\\#/g, '#').replace(/\\;/g, ';');
                        }
                        parsed.push(line);
                    }
                    if (needsConverting)
                        fs.writeFileSync(path.join(configDir, 'bhid.conf'), this._ini.stringify(this._ini.parse(parsed.join('\n'))), { mode: 0o640 });
                }

                try {
                    fs.accessSync('/etc/systemd/system', fs.constants.F_OK);
                    this._app.debug('Creating systemd service').catch(() => { /* do nothing */ });
                    let service = fs.readFileSync(path.join(__dirname, '..', 'systemd.service'), {encoding: 'utf8'});
                    fs.writeFileSync('/etc/systemd/system/bhid.service', service, {mode: 0o644});
                } catch (error) {
                    // do nothing
                }
                try {
                    fs.accessSync('/etc/init.d', fs.constants.F_OK);
                    this._app.debug('Creating sysvinit service').catch(() => { /* do nothing */ });
                    let service = fs.readFileSync(path.join(__dirname, '..', 'sysvinit.service'), {encoding: 'utf8'});
                    fs.writeFileSync('/etc/init.d/bhid', service, {mode: 0o755});
                } catch (error) {
                    // do nothing
                }

                let keysExist = false;
                try {
                    fs.accessSync(path.join(configDir, 'id', 'private.rsa'), fs.constants.F_OK);
                    fs.accessSync(path.join(configDir, 'id', 'public.rsa'), fs.constants.F_OK);
                    keysExist = true;
                } catch (error) {
                    // do nothing
                }

                if (keysExist)
                    return;

                this._app.debug('Creating RSA keys').catch(() => { /* do nothing */ });
                return this._runner.exec(
                        'openssl',
                        [
                            'genrsa',
                            '-out', path.join(configDir, 'id', 'private.rsa'),
                            '2048'
                        ]
                    )
                    .then(result => {
                        if (result.code !== 0)
                            throw new Error('Could not create private key');

                        return this._runner.exec(
                                'openssl',
                                [
                                    'rsa',
                                    '-in', path.join(configDir, 'id', 'private.rsa'),
                                    '-outform', 'PEM',
                                    '-pubout',
                                    '-out', path.join(configDir, 'id', 'public.rsa')
                                ]
                            )
                            .then(result => {
                                if (result.code !== 0)
                                    return result;

                                return this._runner.exec('chmod', [ '600', path.join(configDir, 'id', 'private.rsa') ])
                                    .then(() => {
                                        return result;
                                    });
                            });
                    })
                    .then(result => {
                        if (result.code !== 0)
                            return this.error('Could not create public key');
                    });
            });
    }

    /**
     * Log error and terminate
     * @param {...*} args
     */
    error(...args) {
        return args.reduce(
                (prev, cur) => {
                    return prev.then(() => {
                        return this._app.error(cur.fullStack || cur.stack || cur.message || cur);
                    });
                },
                Promise.resolve()
            )
            .then(
                () => {
                    process.exit(1);
                },
                () => {
                    process.exit(1);
                }
            );
    }
}

module.exports = Install;