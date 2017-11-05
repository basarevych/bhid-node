/**
 * Data event
 * @module peer/events/data
 */
const NError = require('nerror');
const Base = require('./base');

/**
 * Data event class
 */
class Data extends Base {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     * @param {Logger} logger                   Logger service
     * @param {Crypter} crypter                 Crypter service
     */
    constructor(app, config, logger, crypter) {
        super(app);
        this._config = config;
        this._logger = logger;
        this._crypter = crypter;
    }

    /**
     * Service name is 'peer.events.data'
     * @type {string}
     */
    static get provides() {
        return 'peer.events.data';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'crypter' ];
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'data';
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

        let connection = this.peer.connections.get(session.name);
        if (!connection)
            return;

        try {
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

            let [tracker, connectionName] = session.name.split('#');
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
}

module.exports = Data;
