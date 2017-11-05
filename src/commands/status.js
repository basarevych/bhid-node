/**
 * Status command
 * @module commands/status
 */
const path = require('path');
const argvParser = require('argv');
const Base = require('./base');

/**
 * Command class
 */
class Status extends Base {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Runner} runner           Runner service
     */
    constructor(app, config, runner) {
        super(app);
        this._config = config;
        this._runner = runner;
    }

    /**
     * Service name is 'commands.status'
     * @type {string}
     */
    static get provides() {
        return 'commands.status';
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
    async run(argv) {
        argvParser
            .option({
                name: 'help',
                short: 'h',
                type: 'boolean',
            })
            .run(argv);

        try {
            let result = await this._runner.exec(
                path.join(__dirname, '..', '..', 'bin', 'status'),
                [],
                { pipe: process }
            );
            return result.code;
        } catch (error) {
            await this.error(error);
        }
    }
}

module.exports = Status;
