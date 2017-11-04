/**
 * Registered event
 * @module tracker/events/registered
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Registered event class
 */
class Registered extends Base {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, connectionsList) {
        super(app);
        this._config = config;
        this._logger = logger;
        this._connectionsList = connectionsList;
    }

    /**
     * Service name is 'tracker.events.registered'
     * @type {string}
     */
    static get provides() {
        return 'tracker.events.registered';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'connectionsList' ];
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'registered';
    }

    /**
     * Event handler
     * @param {string} name                     Name of the tracker
     * @return {Promise}
     */
    async handle(name) {
        let server = this.tracker.servers.get(name);
        if (!server)
            return;

        this._logger.info(`Registered with ${server.name} as ${server.daemonName} (${server.email})`);
        try {

            let trackedConnections = this._connectionsList.get(name);
            if (!trackedConnections)
                return;

            let merged = new Map([...trackedConnections.serverConnections, ...trackedConnections.clientConnections]);
            for (let connectionName of merged.keys()) {
                let info = this.peer.connections.get(name + '#' + connectionName);
                if (info)
                    this.tracker.sendStatus(name, connectionName);
            }
        } catch (error) {
            this._logger.error(new NError(error, 'Registered.handle()'));
        }
    }
}

module.exports = Registered;
