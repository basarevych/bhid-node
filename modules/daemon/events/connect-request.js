/**
 * Connect Request event
 * @module daemon/events/connect-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Connect Request event class
 */
class ConnectRequest {
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
     * Service name is 'modules.daemon.events.connectRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.connectRequest';
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

        debug(`Got CONNECT REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, updates) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('connect_response', onResponse);

                let reply = this.daemon.ConnectResponse.create({
                    response: value,
                    updates: updates,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.CONNECT_RESPONSE,
                    connectResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                debug(`Sending CONNECT RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.servers.get(message.connectRequest.trackerName || this.tracker.default);
            if (!server)
                return reply(this.daemon.ConnectResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.ConnectResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got CONNECT RESPONSE from tracker`);
                reply(
                    response.connectResponse.response,
                    response.connectResponse.updates
                );
            };
            this.tracker.on('connect_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.ConnectResponse.Result.TIMEOUT);
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.ConnectRequest.create({
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
            this._logger.error(new WError(error, 'ConnectRequest.handle()'));
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