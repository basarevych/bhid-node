/**
 * Server Available event
 * @module tracker/events/server-available
 */
const NError = require('nerror');
const Base = require('./base');

/**
 * Server Available event class
 */
class ServerAvailable extends Base {
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
     * Service name is 'tracker.events.serverAvailable'
     * @type {string}
     */
    static get provides() {
        return 'tracker.events.serverAvailable';
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
        return 'server_available';
    }

    /**
     * Event handler
     * @param {string} name                     Name of the tracker
     * @param {object} message                  The message
     * @return {Promise}
     */
    async handle(name, message) {
        try {
            let connectionName = name + '#' + message.serverAvailable.connectionName;
            this._logger.debug('server-available', `Got SERVER AVAILABLE for ${connectionName}`);

            let connection = this.peer.connections.get(connectionName);
            if (!connection || connection.server || this.peer._closing)
                return;

            let trackedConnections = this._connectionsList.get(name);
            if (trackedConnections) {
                let clientConnection = trackedConnections.clientConnections.get(message.serverAvailable.connectionName);
                if (clientConnection) {
                    connection.internal = message.serverAvailable.internalAddresses;
                    this._connectionsList.updateServerName(name, message.serverAvailable.connectionName, message.serverAvailable.daemonName);
                    this.peer.connect(name, message.serverAvailable.connectionName, 'internal');
                }
            }
        } catch (error) {
            this._logger.error(new NError(error, 'ServerAvailable.handle()'));
        }
    }
}

module.exports = ServerAvailable;
