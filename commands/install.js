/**
 * Install command
 * @module commands/install
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const fs = require('fs');

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
        return this._runner.exec('uname', [ '-s' ])
            .then(result => {
                if (result.code !== 0)
                    throw new Error('Could not get platform name');

                let configDir;
                if (result.stdout.trim() == 'FreeBSD') {
                    configDir = '/usr/local/etc/bhid';
                    debug(`Platform: FreeBSD`);
                } else {
                    configDir = '/etc/bhid';
                    debug(`Platform: Linux`);
                }

                try {
                    fs.symlinkSync(path.join(configDir, 'config.js'), path.join(__dirname, '..', 'config', 'local.js'));
                    console.log('Config symlink created');
                } catch (error) {
                    // do nothing
                }

                try {
                    fs.accessSync(configDir, fs.constants.F_OK);
                    return this.error('Configuration directory already exists');
                } catch (error) {
                    // do nothing
                }

                debug('Creating config dir');
                fs.mkdirSync(configDir, 0o750);
                fs.mkdirSync(path.join(configDir, 'id'), 0o750);
                fs.mkdirSync(path.join(configDir, 'peers'), 0o755);
                fs.mkdirSync(path.join(configDir, 'certs'), 0o755);
                try {
                    fs.mkdirSync('/var/run/bhid', 0o750);
                } catch (error) {
                    // do nothing
                }
                try {
                    fs.mkdirSync('/var/log/bhid', 0o750);
                } catch (error) {
                    // do nothing
                }

                debug('Creating default config');
                let config = fs.readFileSync(path.join(__dirname, '..', 'bhid.conf'), { encoding: 'utf8'});
                fs.writeFileSync(path.join(configDir, 'bhid.conf'), config, { mode: 0o640 });
                config = fs.readFileSync(path.join(__dirname, '..', 'config', 'local.js.example'), { encoding: 'utf8'});
                fs.writeFileSync(path.join(configDir, 'config.js'), config, { mode: 0o640 });

                try {
                    fs.accessSync('/etc/systemd/system', fs.constants.F_OK);
                    debug('Creating service');
                    let service = fs.readFileSync(path.join(__dirname, '..', 'bhid.service'), {encoding: 'utf8'});
                    fs.writeFileSync('/etc/systemd/system/bhid.service', service, {mode: 0o644});
                } catch (error) {
                    console.log('Could not create systemd service - skipping...');
                }

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