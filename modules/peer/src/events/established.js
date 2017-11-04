/**
 * Established event
 * @module peer/events/established
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Established event class
 */
class Established extends Base {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {ConnectionsList} connectionsList     Connections List service
     * @param {Crypter} crypter                     Crypter service
     */
    constructor(app, config, logger, connectionsList, crypter) {
        super(app);
        this._config = config;
        this._logger = logger;
        this._connectionsList = connectionsList;
        this._crypter = crypter;
    }

    /**
     * Service name is 'peer.events.established'
     * @type {string}
     */
    static get provides() {
        return 'peer.events.established';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'connectionsList', 'crypter' ];
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'established';
    }

    /**
     * Event handler
     * @param {string} sessionId                Session ID
     * @return {Promise}
     */
    async handle(sessionId) {
        let session = this.peer.sessions.get(sessionId);
        if (!session)
            return;

        let connection = this.peer.connections.get(session.name);
        if (!connection)
            return;

        try {
            if (!connection.server)
                connection.successful = true;

            let [tracker, connectionName] = session.name.split('#');

            if (connection.server)
                this.front.openServer(tracker, connectionName, sessionId, connection.connectAddress, connection.connectPort);
            else
                this.front.openClient(tracker, connectionName, sessionId, connection.listenAddress, connection.listenPort);

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
}

module.exports = Established;
