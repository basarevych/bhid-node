/**
 * Disconnect Request event
 * @module daemon/events/disconnect-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Disconnect Request event class
 */
class DisconnectRequest {
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
     * Service name is 'modules.daemon.events.disconnectRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.disconnectRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config' ];
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

        debug(`Got DISCONNECT REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = value => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('disconnect_response', onResponse);

                let reply = this.daemon.DisconnectResponse.create({
                    response: value,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.DISCONNECT_RESPONSE,
                    disconnectResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                debug(`Sending DISCONNECT RESPONSE`);
                this.daemon.send(id, data);
            };

            if (!this.tracker.getToken(message.disconnectRequest.trackerName))
                return reply(this.daemon.DisconnectResponse.Result.REJECTED);

            onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got DISCONNECT RESPONSE from tracker`);
                reply(response.disconnectResponse.response);
            };
            this.tracker.on('disconnect_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.DisconnectResponse.Result.TIMEOUT);
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.DisconnectRequest.create({
                token: this.tracker.getToken(message.disconnectRequest.trackerName),
                daemonName: message.disconnectRequest.daemonName,
                path: message.disconnectRequest.path,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.DISCONNECT_REQUEST,
                messageId: relayId,
                disconnectRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.disconnectRequest.trackerName, data);
        } catch (error) {
            this._daemon._logger.error(new WError(error, 'DisconnectRequest.handle()'));
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

module.exports = DisconnectRequest;