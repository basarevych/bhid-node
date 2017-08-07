/**
 * Start command
 * @module commands/start
 */
const path = require('path');
const argvParser = require('argv');

/**
 * Command class
 */
class Start {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Runner} runner           Runner service
     * @param {Install} install         Install command
     */
    constructor(app, config, runner, install) {
        this._app = app;
        this._config = config;
        this._runner = runner;
        this._install = install;
    }

    /**
     * Service name is 'commands.start'
     * @type {string}
     */
    static get provides() {
        return 'commands.start';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'runner', 'commands.install' ];
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
            .option({
                name: 'install',
                short: 'i',
                type: 'boolean',
            })
            .run(argv);

        return Promise.resolve()
            .then(() => {
                if (args.options.install)
                    return this._install.install();
            })
            .then(() => {
                return this.launch();
            })
            .then(rc => {
                process.exit(rc);
            })
            .catch(error => {
                return this.error(error);
            });
    }

    /**
     * Launch the daemon
     */
    launch() {
        return this._runner.exec(
                path.join(__dirname, '..', 'bin', 'daemon'),
                [],
                { pipe: process }
            )
            .then(result => {
                return result.code;
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

module.exports = Start;