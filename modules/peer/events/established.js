/**
 * Established event
 * @module peer/events/established
 */
const uuid = require('uuid');
const NError = require('nerror');

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
     * @param {Crypter} crypter                     Crypter service
     */
    constructor(app, config, logger, connectionsList, crypter) {
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._connectionsList = connectionsList;
        this._crypter = crypter;
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
        return [ 'app', 'config', 'logger', 'connectionsList', 'crypter' ];
    }

    /**
     * Event handler
     * @param {string} sessionId                Session ID
     */
    handle(sessionId) {
        let session = this.peer.sessions.get(sessionId);
        if (!session)
            return;

        let connection = this.peer.connections.get(session.name);
        if (!connection)
            return;

        let [ tracker, connectionName ] = session.name.split('#');

        try {
            if (connection.server)
                this.front.openServer(session.name, sessionId, connection.connectAddress, connection.connectPort);
            else
                this.front.openClient(session.name, sessionId, connection.listenAddress, connection.listenPort);

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
            this._logger.error(new NError(error, `Established.handle()`));
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