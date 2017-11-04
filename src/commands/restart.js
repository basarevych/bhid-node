/**
 * Restart command
 * @module commands/restart
 */
const path = require('path');
const argvParser = require('argv');
const Base = require('./base');

/**
 * Command class
 */
class Restart extends Base {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Start} start             Start command
     * @param {Stop} stop               Stop command
     * @param {Install} install         Install command
     */
    constructor(app, config, start, stop, install) {
        super(app);
        this._config = config;
        this._start = start;
        this._stop = stop;
        this._install = install;
    }

    /**
     * Service name is 'commands.restart'
     * @type {string}
     */
    static get provides() {
        return 'commands.restart';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'commands.start', 'commands.stop', 'commands.install' ];
    }

    /**
     * Run the command
     * @param {string[]} argv           Arguments
     * @return {Promise}
     */
    async run(argv) {
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

        try {
            await this._stop.terminate();
            if (args.options.install)
                await this._install.install();
            return await this._start.launch();
        } catch (error) {
            await this.error(error);
        }
    }
}

module.exports = Restart;
