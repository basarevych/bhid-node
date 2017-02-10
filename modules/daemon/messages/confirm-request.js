/**
 * Confirm Request message
 * @module daemon/messages/confirm-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Confirm Request message class
 */
class ConfirmRequest {
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
     * Service name is 'modules.daemon.messages.confirmRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.messages.confirmRequest';
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

        debug(`Got CONFIRM REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer;
            let reply = (value, token) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                this.tracker.removeListener('confirm_response', onResponse);

                let reply = this.daemon.ConfirmResponse.create({
                    response: value,
                    token: token,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.CONFIRM_RESPONSE,
                    confirmResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this.daemon.send(id, data);
            };

            let onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                reply(response.confirmResponse.response, response.confirmResponse.token);
            };
            this.tracker.on('confirm_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.ConfirmResponse.Result.TIMEOUT, '');
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.ConfirmRequest.create({
                token: message.confirmRequest.token,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.CONFIRM_REQUEST,
                messageId: relayId,
                confirmRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.confirmRequest.trackerName, data);
        } catch (error) {
            this._daemon._logger.error(new WError(error, 'ConfirmRequest.onMessage()'));
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

module.exports = ConfirmRequest;