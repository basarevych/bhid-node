/**
 * Redeem Daemon Request event
 * @module daemon/events/redeem-daemon-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Redeem Daemon Request event class
 */
class RedeemDaemonRequest extends Base {
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
     * Service name is 'daemon.events.redeemDaemonRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.redeemDaemonRequest';
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
        return 'redeem_daemon_request';
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

        this._logger.debug('redeem-daemon-request', `Got REDEEM DAEMON REQUEST`);
        try {
            let masterToken = await this.tracker.getMasterToken(message.redeemDaemonRequest.trackerName);
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, token) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('redeem_daemon_response', onResponse);

                let reply = this.daemon.RedeemDaemonResponse.create({
                    response: value,
                    token: token,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.REDEEM_DAEMON_RESPONSE,
                    redeemDaemonResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('redeem-daemon-request', `Sending REDEEM DAEMON RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.redeemDaemonRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.RedeemDaemonResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('redeem-daemon-request', `Got REDEEM DAEMON RESPONSE from tracker`);
                reply(response.redeemDaemonResponse.response, response.redeemDaemonResponse.token);
            };
            this.tracker.on('redeem_daemon_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.RedeemDaemonResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.RedeemDaemonRequest.create({
                token: masterToken,
                daemonName: message.redeemDaemonRequest.daemonName,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.REDEEM_DAEMON_REQUEST,
                messageId: relayId,
                redeemDaemonRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.redeemDaemonRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'RedeemDaemonRequest.handle()'));
        }
    }
}

module.exports = RedeemDaemonRequest;
