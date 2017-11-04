/**
 * Connect Response event
 * @module peer/events/connect-response
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Connect Response event class
 */
class ConnectResponse extends Base {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     */
    constructor(app, config, logger) {
        super(app);
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'peer.events.connectResponse'
     * @type {string}
     */
    static get provides() {
        return 'peer.events.connectResponse';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger' ];
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'connect_response';
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
            session.accepted = (message.connectResponse.response === this.peer.ConnectResponse.Result.ACCEPTED);
            if (!session.accepted) {
                this._logger.info(`Peer of ${session.name} rejected our connection request (${session.socket.address().address}:${session.socket.address().port})`);
                setTimeout(() => {
                    let reply = this.peer.OuterMessage.create({
                        type: this.peer.OuterMessage.Type.BYE,
                    });
                    let buffer = this.peer.OuterMessage.encode(reply).finish();
                    this.peer.send(sessionId, buffer, true);
                }, 3000);
            }

            if (session.verified && session.accepted && !session.established) {
                session.established = true;
                this.peer.emit('established', sessionId);
            }
        } catch (error) {
            this._logger.error(new NError(error, `ConnectResponse.handle()`));
        }
    }
}

module.exports = ConnectResponse;
