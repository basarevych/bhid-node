/**
 * Connections List event
 * @module tracker/events/connections-list
 */
const NError = require('nerror');
const Base = require('./base');

/**
 * Connections List event class
 */
class ConnectionsList extends Base {
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
     * Service name is 'tracker.events.connectionsList'
     * @type {string}
     */
    static get provides() {
        return 'tracker.events.connectionsList';
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
        return 'connections_list';
    }

    /**
     * Event handler
     * @param {string} name                     Name of the tracker
     * @param {object} message                  The message
     * @return {Promise}
     */
    async handle(name, message) {
        this._logger.debug('connections-list', `Got CONNECTIONS LIST from ${name}`);
        try {
            let list = message.connectionsList;

            let trackedConnections = this._connectionsList.get(name);
            if (trackedConnections) {
                let updated = false;
                for (let connectionName of trackedConnections.serverConnections.keys()) {
                    let found = false;
                    for (let connection of list.serverConnections || []) {
                        if (connectionName === connection.name) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        updated = true;
                        this.front.close(name, connectionName);
                        this.peer.close(name, connectionName);
                        this._connectionsList.delete(name, connectionName, true);
                    }
                }
                for (let connectionName of trackedConnections.clientConnections.keys()) {
                    let found = false;
                    for (let connection of list.clientConnections || []) {
                        if (connectionName === connection.name) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        updated = true;
                        this.front.close(name, connectionName);
                        this.peer.close(name, connectionName);
                        this._connectionsList.delete(name, connectionName, false);
                    }
                }
                if (updated)
                    this._connectionsList.save();
            }
        } catch (error) {
            this._logger.error(new NError(error, 'ConnectionsList.handle()'));
        }
    }
}

module.exports = ConnectionsList;
