/**
 * Install command
 * @module commands/install
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Command class
 */
class Install {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Runner} runner           Runner service
     */
    constructor(app, config, runner) {
        this._app = app;
        this._config = config;
        this._runner = runner;
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
        return [ 'app', 'config', 'runner' ];
    }

    /**
     * Run the command
     * @param {object} argv             Minimist object
     * @return {Promise}
     */
    run(argv) {
        return Promise.resolve()
            .then(() => {
                let configDir;
                if (os.platform() == 'freebsd') {
                    configDir = '/usr/local/etc/bhid';
                    debug(`Platform: FreeBSD`);
                } else {
                    configDir = '/etc/bhid';
                    debug(`Platform: Linux`);
                }

                try {
                    fs.accessSync(configDir, fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync(configDir, 0o750);
                    } catch (error) {
                        this.error(`Could not create ${configDir}`);
                    }
                }
                try {
                    fs.accessSync(path.join(configDir, 'id'), fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync(path.join(configDir, 'id'), 0o750);
                    } catch (error) {
                        this.error(`Could not create ${path.join(configDir, 'id')}`);
                    }
                }
                try {
                    fs.accessSync(path.join(configDir, 'peers'), fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync(path.join(configDir, 'peers'), 0o755);
                    } catch (error) {
                        this.error(`Could not create ${path.join(configDir, 'peers')}`);
                    }
                }
                try {
                    fs.accessSync(path.join(configDir, 'certs'), fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync(path.join(configDir, 'certs'), 0o755);
                    } catch (error) {
                        this.error(`Could not create ${path.join(configDir, 'certs')}`);
                    }
                }
                try {
                    fs.accessSync('/var/run/bhid', fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync('/var/run/bhid', 0o755);
                    } catch (error) {
                        this.error(`Could not create /var/run/bhid`);
                    }
                }
                try {
                    fs.accessSync('/var/log/bhid', fs.constants.F_OK);
                } catch (error) {
                    try {
                        fs.mkdirSync('/var/log/bhid', 0o755);
                    } catch (error) {
                        this.error(`Could not create /var/log/bhid`);
                    }
                }

                try {
                    debug('Creating default config');
                    fs.accessSync(path.join(configDir, 'bhid.conf'), fs.constants.F_OK);
                } catch (error) {
                    try {
                        let config = fs.readFileSync(path.join(__dirname, '..', 'bhid.conf'), { encoding: 'utf8'});
                        fs.writeFileSync(path.join(configDir, 'bhid.conf'), config, { mode: 0o640 });
                    } catch (error) {
                        this.error(`Could not create bhid.conf`);
                    }
                }
                try {
                    fs.accessSync('/etc/systemd/system', fs.constants.F_OK);
                    debug('Creating systemd service');
                    let service = fs.readFileSync(path.join(__dirname, '..', 'systemd.service'), {encoding: 'utf8'});
                    fs.writeFileSync('/etc/systemd/system/bhid.service', service, {mode: 0o644});
                } catch (error) {
                    // do nothing
                }
                try {
                    fs.accessSync('/etc/init.d', fs.constants.F_OK);
                    debug('Creating sysvinit service');
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

                debug('Creating RSA keys');
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
                            throw new Error('Could not create public key');
                    });
            })
            .then(() => {
                process.exit(0);
            })
            .catch(error => {
                this.error(error.message);
            });
    }

    /**
     * Log error and terminate
     * @param {...*} args
     */
    error(...args) {
        console.error(...args);
        process.exit(1);
    }
}

module.exports = Install;