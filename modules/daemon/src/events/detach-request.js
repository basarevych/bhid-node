/**
 * Detach Request event
 * @module daemon/events/detach-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Detach Request event class
 */
class DetachRequest extends Base {
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
     * Service name is 'daemon.events.detachRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.detachRequest';
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
        return 'detach_request';
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

        this._logger.debug('detach-request', `Got DETACH REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = value => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('detach_response', onResponse);

                let reply = this.daemon.DetachResponse.create({
                    response: value,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.DETACH_RESPONSE,
                    detachResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('detach-request', `Sending DETACH RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.detachRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.DetachResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.DetachResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('detach-request', `Got DETACH RESPONSE from tracker`);
                reply(response.detachResponse.response);
            };
            this.tracker.on('detach_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.DetachResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.DetachRequest.create({
                path: message.detachRequest.path,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.DETACH_REQUEST,
                messageId: relayId,
                detachRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.detachRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'DetachRequest.handle()'));
        }
    }
}

module.exports = DetachRequest;
