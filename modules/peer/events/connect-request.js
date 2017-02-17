/**
 * Connect Request event
 * @module peer/events/connect-request
 */
const debug = require('debug')('bhid:peer');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Connect Request event class
 */
class ConnectRequest {
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
     * Service name is 'modules.peer.events.connectRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.peer.events.connectRequest';
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
     * @param {object} message                  The message
     */
    handle(name, sessionId, message) {
        let connection = this.peer.connections.get(name);
        if (!connection)
            return;

        let info = connection.server ? connection.clients.get(sessionId) : connection;
        if (!info)
            return;

        let session = this._crypter.sessions.get(sessionId);
        if (!session)
            return;

        this._crypter.verify(
                sessionId,
                connection.tracker,
                message.connectRequest.identity,
                message.connectRequest.publicKey,
                message.connectRequest.signature
            )
            .then(result => {
                info.verified = result.verified;

                if (info.verified) {
                    session.peerKey = new Uint8Array(Buffer.from(message.connectRequest.publicKey, 'base64'));
                    session.peerName = result.name;
                } else {
                    this._logger.info(`Peer for ${name} rejected`);
                    if (!connection.server) {
                        if (connection.internal.connected)
                            connection.internal.rejected = true;
                        else if (connection.external.connected)
                            connection.external.rejected = true;
                    }
                }

                let response = this.peer.ConnectResponse.create({
                    response: info.verified ? this.peer.ConnectResponse.Result.ACCEPTED : this.peer.ConnectResponse.Result.REJECTED,
                });
                let reply = this.peer.OuterMessage.create({
                    type: this.peer.OuterMessage.Type.CONNECT_RESPONSE,
                    connectResponse: response,
                });
                let buffer = this.peer.OuterMessage.encode(reply).finish();

                debug(info.verified ? 'Sending ACCEPT' : 'Sending REJECT');
                this.peer.send(name, sessionId, buffer);

                if (!info.verified) {
                    reply = this.peer.OuterMessage.create({
                        type: this.peer.OuterMessage.Type.BYE,
                    });
                    buffer = this.peer.OuterMessage.encode(reply).finish();
                    this.peer.send(name, sessionId, buffer, true);
                }

                if (info.verified && info.accepted) {
                    if (connection.server)
                        this.front.openServer(name, sessionId, connection.connectAddress, connection.connectPort);
                    else
                        this.front.openClient(name, sessionId, connection.listenAddress, connection.listenPort);
                }
            })
            .catch(error => {
                this._logger.error(new WError(error, `ConnectRequest.handle()`));
            });
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

module.exports = ConnectRequest;