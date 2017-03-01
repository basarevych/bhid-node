/**
 * Attach Request event
 * @module daemon/events/attach-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Attach Request event class
 */
class AttachRequest {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, connectionsList) {
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._connectionsList = connectionsList;
    }

    /**
     * Service name is 'modules.daemon.events.attachRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.attachRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'modules.peer.connectionsList' ];
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

        debug(`Got ATTACH REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, updates) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('attach_response', onResponse);

                let reply = this.daemon.AttachResponse.create({
                    response: value,
                    updates: updates,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.ATTACH_RESPONSE,
                    attachResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                debug(`Sending ATTACH RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.attachRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.AttachResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.AttachResponse.Result.NOT_REGISTERED);
            let token = this._connectionsList.getImport(message.attachRequest.trackerName, message.attachRequest.path);
            if (!token)
                return reply(this.daemon.AttachResponse.Result.REJECTED);

            onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got ATTACH RESPONSE from tracker`);
                reply(
                    response.attachResponse.response,
                    response.attachResponse.updates
                );
            };
            this.tracker.on('attach_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.AttachResponse.Result.TIMEOUT);
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.AttachRequest.create({
                token: token,
                path: message.attachRequest.path,
                addressOverride: message.attachRequest.addressOverride,
                portOverride: message.attachRequest.portOverride,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.ATTACH_REQUEST,
                messageId: relayId,
                attachRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.attachRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new WError(error, 'AttachRequest.handle()'));
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

module.exports = AttachRequest;