/**
 * Connection event
 * @module peer/events/connection
 */
const debug = require('debug')('bhid:peer');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Connection event class
 */
class Connection {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     * @param {Logger} logger                   Logger service
     * @param {Crypter} crypter                 Crypter service
     */
    constructor(app, config, logger, crypter) {
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._crypter = crypter;
    }

    /**
     * Service name is 'modules.peer.events.connection'
     * @type {string}
     */
    static get provides() {
        return 'modules.peer.events.connection';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'modules.peer.crypter' ];
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

        let session = this._crypter.sessions.get(sessionId);
        if (!session)
            return;

        try {
            let request = this.peer.ConnectRequest.create({
                identity: this._crypter.identity,
                publicKey: session.publicKey,
                signature: this._crypter.sign(session.publicKey),
                encrypted: connection.encrypted,
            });
            let msg = this.peer.OuterMessage.create({
                type: this.peer.OuterMessage.Type.CONNECT_REQUEST,
                connectRequest: request,
            });
            let data = this.peer.OuterMessage.encode(msg).finish();
            debug(`Sending CONNECT REQUEST`);
            this.peer.send(name, sessionId, data);
        } catch (error) {
            this._logger.error(new WError(error, 'Connection.handle()'));
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

module.exports = Connection;