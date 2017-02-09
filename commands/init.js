/**
 * Init command
 * @module commands/init
 */
const debug = require('debug')('bhid:command');

/**
 * Command class
 */
class Init {
    /**
     * Create the service
     */
    constructor() {
    }

    /**
     * Service name is 'commands.init'
     * @type {string}
     */
    static get provides() {
        return 'commands.init';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [];
    }

    /**
     * Run the command
     * @param {object} argv             Minimist object
     */
    run(argv) {
        if (argv['_'].length < 3) {
            console.error('Invalid parameters');
            process.exit(1);
        }
    }
}

module.exports = Init;