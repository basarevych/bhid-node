/**
 * Connect Request event
 * @module peer/events/connect-request
 */
const uuid = require('uuid');
const NError = require('nerror');

/**
 * Connect Request event class
 */
class ConnectRequest {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {Crypter} crypter                     Crypter service
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
        return [ 'app', 'config', 'logger', 'crypter' ];
    }

    /**
     * Event handler
     * @param {string} sessionId                Session ID
     * @param {object} message                  The message
     */
    handle(sessionId, message) {
        let session = this.peer.sessions.get(sessionId);
        if (!session)
            return;

        if (session.name && session.name !== message.connectRequest.connectionName)
            return;

        let connection = this.peer.connections.get(message.connectRequest.connectionName);
        if (!connection)
            return;

        if (!session.name) {
            session.name = connection.name;
            connection.sessionIds.add(sessionId);
            let cryptSession = this._crypter.sessions.get(sessionId);
            if (cryptSession)
                cryptSession.connection = connection.name;
        }

        this._crypter.verify(
                sessionId,
                connection.tracker,
                message.connectRequest.identity,
                message.connectRequest.publicKey,
                message.connectRequest.signature,
                connection.fixed
            )
            .then(result => {
                session.verified = result.verified;

                if (session.verified) {
                    let cryptSession = this._crypter.sessions.get(sessionId);
                    cryptSession.peerKey = new Uint8Array(Buffer.from(message.connectRequest.publicKey, 'base64'));
                    cryptSession.peerName = result.name;
                    this._logger.info(
                        `Peer of ${message.connectRequest.connectionName} authenticated as ${result.name} (${session.socket.address().address}:${session.socket.address().port})`
                    );
                } else {
                    if (result.name && connection.fixed && connection.peers.indexOf(result.name) === -1) {
                        this._logger.info(
                            `Peer of ${message.connectRequest.connectionName} is not in the fixed list (${result.name}) and rejected (${session.socket.address().address}:${session.socket.address().port})`
                        );
                    } else {
                        this._logger.info(
                            `Peer of ${message.connectRequest.connectionName} is ${result.name ? 'not ' + result.name : 'unknown'} and rejected (${session.socket.address().address}:${session.socket.address().port})`
                        );
                    }
                }

                let response = this.peer.ConnectResponse.create({
                    response: session.verified ? this.peer.ConnectResponse.Result.ACCEPTED : this.peer.ConnectResponse.Result.REJECTED,
                });
                let reply = this.peer.OuterMessage.create({
                    type: this.peer.OuterMessage.Type.CONNECT_RESPONSE,
                    connectResponse: response,
                });
                let buffer = this.peer.OuterMessage.encode(reply).finish();

                this._logger.debug('connect-request', session.verified ? 'Sending ACCEPT' : 'Sending REJECT');
                this.peer.send(sessionId, buffer);

                if (session.verified) {
                    if (session.accepted && !session.established) {
                        session.established = true;
                        this.peer.emit('established', sessionId);
                    } else if (connection.server) {
                        this.peer.sendConnectRequest(sessionId);
                    }
                }
            })
            .catch(error => {
                this._logger.error(new NError(error, `ConnectRequest.handle()`));
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