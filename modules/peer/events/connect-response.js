/**
 * Connect Response event
 * @module peer/events/connect-response
 */
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Connect Response event class
 */
class ConnectResponse {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     */
    constructor(app, config, logger) {
        this._app = app;
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'modules.peer.events.connectResponse'
     * @type {string}
     */
    static get provides() {
        return 'modules.peer.events.connectResponse';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger' ];
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

        let session = this.peer.sessions.get(sessionId);
        if (!session)
            return;

        session.accepted = (message.connectResponse.response === this.peer.ConnectResponse.Result.ACCEPTED);
        if (!session.accepted) {
            this._logger.info(`Peer of ${name} rejected our connection request: ${session.socket.remoteAddress}:${session.socket.remotePort}`);
            setTimeout(() => {
                let reply = this.peer.OuterMessage.create({
                    type: this.peer.OuterMessage.Type.BYE,
                });
                let buffer = this.peer.OuterMessage.encode(reply).finish();
                this.peer.send(name, sessionId, buffer, true);
            }, 3000);
        }

        if (session.verified && session.accepted && !session.established) {
            session.established = true;
            this.peer.emit('established', name, sessionId);
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

module.exports = ConnectResponse;