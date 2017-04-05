/**
 * Server Available event
 * @module tracker/events/server-available
 */
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Server Available event class
 */
class ServerAvailable {
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
     * Service name is 'modules.tracker.events.serverAvailable'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker.events.serverAvailable';
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
        let connectionName = name + '#' + message.serverAvailable.connectionName;
        let connection = this.peer.connections.get(connectionName);
        if (!connection || connection.server)
            return;

        this._logger.debug('server-available', `Got SERVER AVAILABLE for ${connectionName}`);

        let success = true;
        if (connection.peers.length === 0) {
            success = false;
            let trackedConnections = this._connectionsList.get(name);
            if (trackedConnections) {
                let clientConnection = trackedConnections.clientConnections.get(message.serverAvailable.connectionName);
                if (clientConnection) {
                    clientConnection.server = message.serverAvailable.daemonName;
                    this._connectionsList.update(name, message.serverAvailable.connectionName, false, clientConnection, false);
                    this._connectionsList.save();
                    success = true;
                }
            }
        }

        if (success)
            this.peer.connect(connectionName, 'internal', message.serverAvailable.internalAddresses);
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

module.exports = ServerAvailable;