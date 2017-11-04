/**
 * Connect Request event
 * @module peer/events/connect-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Connect Request event class
 */
class ConnectRequest extends Base {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {Crypter} crypter                     Crypter service
     * @param {ConnectionsList} connectionsList     ConnectionsList service
     */
    constructor(app, config, logger, crypter, connectionsList) {
        super(app);
        this._config = config;
        this._logger = logger;
        this._crypter = crypter;
        this._connectionsList = connectionsList;
    }

    /**
     * Service name is 'peer.events.connectRequest'
     * @type {string}
     */
    static get provides() {
        return 'peer.events.connectRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return ['app', 'config', 'logger', 'crypter', 'connectionsList'];
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'connect_request';
    }

    /**
     * Event handler
     * @param {string} sessionId                Session ID
     * @param {object} message                  The message
     * @return {Promise}
     */
    async handle(sessionId, message) {
        let session = this.peer.sessions.get(sessionId);
        if (!session)
            return;

        try {
            let reply = accepted => {
                let response = this.peer.ConnectResponse.create({
                    response: accepted ? this.peer.ConnectResponse.Result.ACCEPTED : this.peer.ConnectResponse.Result.REJECTED,
                });
                let msg = this.peer.OuterMessage.create({
                    type: this.peer.OuterMessage.Type.CONNECT_RESPONSE,
                    connectResponse: response,
                });
                let buffer = this.peer.OuterMessage.encode(msg).finish();
                this._logger.debug('connect-request', accepted ? 'Sending ACCEPT' : 'Sending REJECT');
                this.peer.send(sessionId, buffer);
            };

            if (session.name && session.name !== message.connectRequest.connectionName)
                return reply(false);

            let connection = this.peer.connections.get(message.connectRequest.connectionName);
            if (!connection)
                return reply(false);

            if (!session.name) {
                session.name = connection.name;
                connection.sessionIds.add(sessionId);
                let cryptSession = this._crypter.sessions.get(sessionId);
                if (cryptSession)
                    cryptSession.connection = connection.name;
            }

            let result = await this._crypter.verify(
                sessionId,
                connection.tracker,
                message.connectRequest.identity,
                message.connectRequest.publicKey,
                message.connectRequest.signature,
                connection.fixed
            );
            session.verified = result.verified;

            if (session.verified) {
                let cryptSession = this._crypter.sessions.get(sessionId);
                cryptSession.peerKey = new Uint8Array(Buffer.from(message.connectRequest.publicKey, 'base64'));
                cryptSession.peerName = result.name;
                if (!connection.server)
                    this._connectionsList.updateServerName(connection.tracker, connection.name, cryptSession.peerName);
                this._logger.info(
                    `Peer ${result.name} of ${message.connectRequest.connectionName} passed identity check (${session.socket.address().address}:${session.socket.address().port})`
                );
            } else {
                if (result.name && connection.fixed && connection.peers.indexOf(result.name) === -1) {
                    this._logger.error(
                        `Peer ${result.name} of ${message.connectRequest.connectionName} is not in the fixed list and rejected (${session.socket.address().address}:${session.socket.address().port})`
                    );
                } else {
                    this._logger.error(
                        `Peer ${result.name ? result.name : 'unknown'} of ${message.connectRequest.connectionName} failed identity check (${session.socket.address().address}:${session.socket.address().port})`
                    );
                }
            }

            reply(session.verified);

            if (session.verified) {
                if (session.accepted && !session.established) {
                    session.established = true;
                    this.peer.emit('established', sessionId);
                } else if (connection.server) {
                    this.peer.sendConnectRequest(sessionId);
                }
            }
        } catch (error) {
            this._logger.error(new NError(error, `ConnectRequest.handle()`));
        }
    }
}

module.exports = ConnectRequest;
