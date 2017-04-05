/**
 * Redeem Master Request event
 * @module daemon/events/redeem-master-request
 */
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Redeem Master Request event class
 */
class RedeemMasterRequest {
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
     * Service name is 'modules.daemon.events.redeemMasterRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.redeemMasterRequest';
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

        this._logger.debug('redeem-master-request', `Got REDEEM MASTER REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = value => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('redeem_master_response', onResponse);

                let reply = this.daemon.RedeemMasterResponse.create({
                    response: value,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.REDEEM_MASTER_RESPONSE,
                    redeemMasterResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('redeem-master-request', `Sending REDEEM MASTER RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.redeemMasterRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.RedeemMasterResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('redeem-master-request', `Got REDEEM MASTER RESPONSE from tracker`);
                reply(response.redeemMasterResponse.response);
            };
            this.tracker.on('redeem_master_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.RedeemMasterResponse.Result.TIMEOUT);
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.RedeemMasterRequest.create({
                email: message.redeemMasterRequest.email,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.REDEEM_MASTER_REQUEST,
                messageId: relayId,
                redeemMasterRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.redeemMasterRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new WError(error, 'RedeemMasterRequest.handle()'));
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

module.exports = RedeemMasterRequest;