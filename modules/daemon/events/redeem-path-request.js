/**
 * Redeem Path Request event
 * @module daemon/events/redeem-path-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Redeem Path Request event class
 */
class RedeemPathRequest {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     * @param {Logger} logger                   Logger service
     */
    constructor(app, config, logger) {
        this._app = app;
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'modules.daemon.events.redeemPathRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.redeemPathRequest';
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
     * @param {string} id           ID of the client
     * @param {object} message      The message
     */
    handle(id, message) {
        let client = this.daemon.clients.get(id);
        if (!client)
            return;

        debug(`Got REDEEM PATH REQUEST`);
        try {
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
                debug(`Sending REDEEM PATH RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.redeemPathRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.RedeemPathResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got REDEEM PATH RESPONSE from tracker`);
                reply(response.redeemPathResponse.response, response.redeemPathResponse.token);
            };
            this.tracker.on('redeem_path_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.RedeemPathResponse.Result.TIMEOUT);
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.RedeemPathRequest.create({
                token: message.redeemPathRequest.token,
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
            this._logger.error(new WError(error, 'RedeemPathRequest.handle()'));
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

module.exports = RedeemPathRequest;