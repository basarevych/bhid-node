/**
 * Redeem Daemon Request event
 * @module daemon/events/redeem-daemon-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Redeem Daemon Request event class
 */
class RedeemDaemonRequest {
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
     * Service name is 'modules.daemon.events.redeemDaemonRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.redeemDaemonRequest';
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

        debug(`Got REDEEM DAEMON REQUEST`);
        try {
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
                debug(`Sending REDEEM DAEMON RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.redeemDaemonRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.RedeemDaemonResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got REDEEM DAEMON RESPONSE from tracker`);
                reply(response.redeemDaemonResponse.response, response.redeemDaemonResponse.token);
            };
            this.tracker.on('redeem_daemon_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.RedeemDaemonResponse.Result.TIMEOUT);
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.RedeemDaemonRequest.create({
                token: message.redeemDaemonRequest.token,
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
            this._logger.error(new WError(error, 'RedeemDaemonRequest.handle()'));
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

module.exports = RedeemDaemonRequest;