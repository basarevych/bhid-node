/**
 * Connections List event
 * @module tracker/events/connections-list
 */
const uuid = require('uuid');
const NError = require('nerror');

/**
 * Connections List event class
 */
class ConnectionsList {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, connectionsList) {
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._connectionsList = connectionsList;
    }

    /**
     * Service name is 'modules.tracker.events.connectionsList'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker.events.connectionsList';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'connectionsList' ];
    }

    /**
     * Event handler
     * @param {string} name                     Name of the tracker
     * @param {object} message                  The message
     */
    handle(name, message) {
        this._logger.debug('connections-list', `Got CONNECTIONS LIST from ${name}`);
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
                    this._connectionsList.delete(name, connectionName, false);
                }
            }
            if (updated)
                this._connectionsList.save();
        }
    }

    /**
     * Retrieve tracker server
     * @return {Tracker}
     */
    get tracker() {
        if (this._tracker)
            return this._tracker;
        this._tracker = this._app.get('servers').get('tracker');
        return this._tracker;
    }

    /**
     * Retrieve peer server
     * @return {Peer}
     */
    get peer() {
        if (this._peer)
            return this._peer;
        this._peer = this._app.get('servers').get('peer');
        return this._peer;
    }
}

module.exports = ConnectionsList;