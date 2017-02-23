/**
 * Established event
 * @module peer/events/established
 */
const debug = require('debug')('bhid:peer');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Established event class
 */
class Established {
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
     * Service name is 'modules.peer.events.established'
     * @type {string}
     */
    static get provides() {
        return 'modules.peer.events.established';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'modules.peer.connectionsList' ];
    }

    /**
     * Event handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     */
    handle(name, sessionId) {
        let connection = this.peer.connections.get(name);
        if (!connection)
            return;

        let session = this.peer.sessions.get(sessionId);
        if (!session)
            return;

        if (!connection.server && connection.sessionId)
            return;

        let parts = name.split('#');
        if (parts.length != 2)
            return;

        try {
            if (connection.server) {
                this.front.openServer(name, sessionId, connection.connectAddress, connection.connectPort);
            } else {
                connection.sessionId = sessionId;
                this.peer.dropExtra(name);
                this.front.openClient(name, sessionId, connection.listenAddress, connection.listenPort);
            }

            let tracker = parts[0];
            let connectionName = parts[1];
            let trackedConnections = this._connectionsList.get(tracker);
            if (trackedConnections) {
                let connected;
                let serverInfo = trackedConnections.serverConnections.get(connectionName);
                let clientInfo = trackedConnections.clientConnections.get(connectionName);
                if (serverInfo)
                    connected = ++serverInfo.connected;
                else if (clientInfo)
                    connected = ++clientInfo.connected;

                if (connected)
                    this.tracker.sendStatus(tracker, connectionName);
            }
        } catch (error) {
            this._logger.error(new WError(error, `ConnectRequest.handle()`));
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

    /**
     * Retrieve front server
     * @return {Front}
     */
    get front() {
        if (this._front)
            return this._front;
        this._front = this._app.get('servers').get('front');
        return this._front;
    }
}

module.exports = Established;