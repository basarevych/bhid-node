/**
 * Stop command
 * @module commands/stop
 */
const path = require('path');
const argvParser = require('argv');

/**
 * Command class
 */
class Stop {
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
     * Service name is 'commands.stop'
     * @type {string}
     */
    static get provides() {
        return 'commands.stop';
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

        return this.terminate()
            .then(() => {
                process.exit(0);
            })
            .catch(error => {
                return this.error(error);
            });
    }

    /**
     * Kill the daemon and wait for exit
     */
    terminate() {
        return this._runner.exec(path.join(__dirname, '..', 'bin', 'status'), [ '/var/run/bhit/daemon.pid' ])
            .then(result => {
                if (result.code === 0) {
                    return this._runner.exec(
                        'kill',
                        [ '/var/run/bhid/daemon.pid', 'SIGTERM' ],
                        { pipe: process }
                    );
                }

                return new Promise((resolve, reject) => {
                    let tries = 0;
                    let waitExit = () => {
                        this._runner.exec(path.join(__dirname, '..', 'bin', 'status'), [ '/var/run/bhid/daemon.pid' ])
                            .then(result => {
                                if (result.code === 100)
                                    return resolve();

                                if (result.code !== 0)
                                    return reject(new Error('Could not get daemon status'));

                                if (++tries > 60)
                                    return reject(new Error('Daemon would not exit'));

                                setTimeout(() => { waitExit(); }, 500);
                            })
                            .catch(error => {
                                reject(error);
                            });
                    };
                    waitExit();
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

module.exports = Stop;