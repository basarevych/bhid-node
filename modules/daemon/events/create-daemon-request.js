/**
 * Create Daemon Request event
 * @module daemon/events/create-daemon-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Create Daemon Request event class
 */
class CreateDaemonRequest {
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
     * Service name is 'modules.daemon.events.createDaemonRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.createDaemonRequest';
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

        debug(`Got CREATE DAEMON REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, name, token) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('create_daemon_response', onResponse);

                let reply = this.daemon.CreateDaemonResponse.create({
                    response: value,
                    daemonName: name || '',
                    token: token || '',
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.CREATE_DAEMON_RESPONSE,
                    createDaemonResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                debug(`Sending CREATE DAEMON RESPONSE`);
                this.daemon.send(id, data);
            };

            onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got CREATE DAEMON RESPONSE from tracker`);
                reply(
                    response.createDaemonResponse.response,
                    response.createDaemonResponse.daemonName,
                    response.createDaemonResponse.token
                );
            };
            this.tracker.on('create_daemon_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.CreateDaemonResponse.Result.TIMEOUT);
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.CreateDaemonRequest.create({
                token: message.createDaemonRequest.token,
                daemonName: message.createDaemonRequest.daemonName,
                randomize: message.createDaemonRequest.randomize,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.CREATE_DAEMON_REQUEST,
                messageId: relayId,
                createDaemonRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.createDaemonRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new WError(error, 'CreateDaemonRequest.handle()'));
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

module.exports = CreateDaemonRequest;