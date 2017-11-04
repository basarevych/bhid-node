/**
 * Confirm Request event
 * @module daemon/events/confirm-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Confirm Request event class
 */
class ConfirmRequest extends Base {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     * @param {Logger} logger                   Logger service
     */
    constructor(app, config, logger) {
        super(app);
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'daemon.events.confirmRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.confirmRequest';
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
        return 'confirm_request';
    }

    /**
     * Event handler
     * @param {string} id           ID of the client
     * @param {object} message      The message
     * @return {Promise}
     */
    async handle(id, message) {
        let client = this.daemon.clients.get(id);
        if (!client)
            return;

        this._logger.debug('confirm-request', `Got CONFIRM REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, token) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('confirm_response', onResponse);

                let reply = this.daemon.ConfirmResponse.create({
                    response: value,
                    token: token || '',
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.CONFIRM_RESPONSE,
                    confirmResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('confirm-request', `Sending CONFIRM RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.confirmRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.ConfirmResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('confirm-request', `Got CONFIRM RESPONSE from tracker`);
                reply(response.confirmResponse.response, response.confirmResponse.token);
            };
            this.tracker.on('confirm_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.ConfirmResponse.Result.TIMEOUT),
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
            this._logger.error(new NError(error, 'ConfirmRequest.handle()'));
        }
    }
}

module.exports = ConfirmRequest;
