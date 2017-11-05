/**
 * Install command
 * @module commands/install
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const argvParser = require('argv');
const Base = require('./base');

/**
 * Command class
 */
class Install extends Base {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Ini} ini                 Ini service
     */
    constructor(app, config, ini) {
        super(app);
        this._config = config;
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
        return [ 'app', 'config', 'ini' ];
    }

    /**
     * Run the command
     * @param {string[]} argv           Arguments
     * @return {Promise}
     */
    async run(argv) {
        argvParser
            .option({
                name: 'help',
                short: 'h',
                type: 'boolean',
            })
            .run(argv);

        try {
            await this.install();
            return 0;
        } catch (error) {
            await this.error(error);
        }
    }

    /**
     * Install bhid
     * @return {Promise}
     */
    async install() {
        let configDir;
        if (os.platform() === 'freebsd') {
            configDir = '/usr/local/etc/bhid';
            await this._app.debug(`Platform: FreeBSD`);
        } else {
            configDir = '/etc/bhid';
            await this._app.debug(`Platform: Linux`);
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
            fs.accessSync(path.join(configDir, 'master'), fs.constants.F_OK);
        } catch (error) {
            try {
                fs.mkdirSync(path.join(configDir, 'master'), 0o700);
            } catch (error) {
                return this.error(`Could not create ${path.join(configDir, 'master')}`);
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
            await this._app.debug('Creating default config');
            fs.accessSync(path.join(configDir, 'bhid.conf'), fs.constants.F_OK);
            configExists = true;
        } catch (error) {
            try {
                let config = fs.readFileSync(path.join(__dirname, '..', '..', 'bhid.conf'), { encoding: 'utf8' });
                fs.writeFileSync(path.join(configDir, 'bhid.conf'), config, { mode: 0o640 });
            } catch (error) {
                return this.error(`Could not create bhid.conf`);
            }
        }
        if (configExists) {
            let contents = fs.readFileSync(path.join(configDir, 'bhid.conf'), { encoding: 'utf8' });
            let parsed = [];
            let needsConverting = false;
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
            await this._app.debug('Creating systemd service');
            let service = fs.readFileSync(path.join(__dirname, '..', '..', 'systemd.service'), {encoding: 'utf8'});
            fs.writeFileSync('/etc/systemd/system/bhid.service', service, {mode: 0o644});
        } catch (error) {
            // do nothing
        }
        try {
            fs.accessSync('/etc/init.d', fs.constants.F_OK);
            await this._app.debug('Creating sysvinit service');
            let service = fs.readFileSync(path.join(__dirname, '..', '..', 'sysvinit.service'), {encoding: 'utf8'});
            fs.writeFileSync('/etc/init.d/bhid', service, {mode: 0o755});
        } catch (error) {
            // do nothing
        }
    }
}

module.exports = Install;
