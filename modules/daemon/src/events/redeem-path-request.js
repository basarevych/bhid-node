/**
 * Redeem Path Request event
 * @module daemon/events/redeem-path-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Redeem Path Request event class
 */
class RedeemPathRequest extends Base {
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
     * Service name is 'daemon.events.redeemPathRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.redeemPathRequest';
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
        return 'redeem_path_request';
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

        this._logger.debug('redeem-path-request', `Got REDEEM PATH REQUEST`);
        try {
            let masterToken = await this.tracker.getMasterToken(message.redeemPathRequest.trackerName);
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, token) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('redeem_path_response', onResponse);

                let reply = this.daemon.RedeemPathResponse.create({
                    response: value,
                    token: token,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.REDEEM_PATH_RESPONSE,
                    redeemPathResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('redeem-path-request', `Sending REDEEM PATH RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.redeemPathRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.RedeemPathResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('redeem-path-request', `Got REDEEM PATH RESPONSE from tracker`);
                reply(response.redeemPathResponse.response, response.redeemPathResponse.token);
            };
            this.tracker.on('redeem_path_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.RedeemPathResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.RedeemPathRequest.create({
                token: masterToken,
                path: message.redeemPathRequest.path,
                type: message.redeemPathRequest.type,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.REDEEM_PATH_REQUEST,
                messageId: relayId,
                redeemPathRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.redeemPathRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'RedeemPathRequest.handle()'));
        }
    }
}

module.exports = RedeemPathRequest;
