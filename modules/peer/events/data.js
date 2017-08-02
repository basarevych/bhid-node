/**
 * Data event
 * @module peer/events/data
 */
const uuid = require('uuid');
const NError = require('nerror');

/**
 * Data event class
 */
class Data {
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
     * Service name is 'modules.peer.events.data'
     * @type {string}
     */
    static get provides() {
        return 'modules.peer.events.data';
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

        let connection = this.peer.connections.get(session.name);
        if (!connection)
            return;

        let data;
        if (connection.encrypted)
            data = this._crypter.decrypt(sessionId, message.encryptedMessage.nonce, message.encryptedMessage.payload);
        else
            data = message.message;

        if (!data) {
            if (connection.encrypted)
                this._logger.error(`Could not decrypt message for ${session.name}`);
            session.socket.end();
            session.wrapper.detach();
            return;
        }

        let innerMessage;
        try {
            innerMessage = this.peer.InnerMessage.decode(data);
        } catch (error) {
            this._logger.error(`Peer of ${session.name} inner protocol error: ${error.message}`);
            return;
        }

        let [ tracker, connectionName ] = session.name.split('#');

        try {
            switch (innerMessage.type) {
                case this.peer.InnerMessage.Type.OPEN:
                    this.front.connect(tracker, connectionName, sessionId, innerMessage.id);
                    break;
                case this.peer.InnerMessage.Type.DATA:
                    this.front.relay(tracker, connectionName, sessionId, innerMessage.id, innerMessage.data);
                    break;
                case this.peer.InnerMessage.Type.CLOSE:
                    this.front.disconnect(tracker, connectionName, sessionId, innerMessage.id);
                    break;
            }
        } catch (error) {
            this._logger.error(new NError(error, 'Data.handle()'));
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

module.exports = Data;