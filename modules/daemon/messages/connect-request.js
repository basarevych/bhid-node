/**
 * Connect Request message
 * @module daemon/messages/connect-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Connect Request message class
 */
class ConnectRequest {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     */
    constructor(app, config) {
        this._app = app;
        this._config = config;
    }

    /**
     * Service name is 'modules.daemon.messages.connectRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.messages.connectRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config' ];
    }

    /**
     * Message handler
     * @param {string} id           ID of the client
     * @param {object} message      The message
     */
    onMessage(id, message) {
        let client = this.daemon.clients.get(id);
        if (!client)
            return;

        debug(`Got CONNECT REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer;
            let reply = value => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                this.tracker.removeListener('connect_response', onResponse);

                let reply = this.daemon.ConnectResponse.create({
                    response: value,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.CONNECT_RESPONSE,
                    connectResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this.daemon.send(id, data);
            };

            if (!this.tracker.getToken(message.connectRequest.trackerName))
                return reply(this.daemon.ConnectResponse.Result.REJECTED);

            let onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                reply(response.connectResponse.response);
            };
            this.tracker.on('connect_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.ConnectResponse.Result.TIMEOUT, '');
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.ConnectRequest.create({
                token: this.tracker.getToken(message.connectRequest.trackerName),
                daemonName: message.connectRequest.daemonName,
                connectToken: message.connectRequest.token,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.CONNECT_REQUEST,
                messageId: relayId,
                connectRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.connectRequest.trackerName, data);
        } catch (error) {
            this._daemon._logger.error(new WError(error, 'ConnectRequest.onMessage()'));
        }
    }

    /**
     * Retrieve daemon server
     * @return {Daemon}
     */
    get daemon() {
        if (this._daemon)
            return this._daemon;
        this._daemon = this._app.get('servers').get('daemon');
        return this._daemon;
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
}

module.exports = ConnectRequest;