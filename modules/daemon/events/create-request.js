/**
 * Create Request event
 * @module daemon/events/create-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Create Request event class
 */
class CreateRequest {
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
     * Service name is 'modules.daemon.events.createRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.createRequest';
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

        debug(`Got CREATE REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, serverToken, clientToken) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('create_response', onResponse);

                let reply = this.daemon.CreateResponse.create({
                    response: value,
                    serverToken: serverToken || '',
                    clientToken: clientToken || '',
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.CREATE_RESPONSE,
                    createResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                debug(`Sending CREATE RESPONSE`);
                this.daemon.send(id, data);
            };

            if (!this.tracker.getToken(message.createRequest.trackerName))
                return reply(this.daemon.CreateResponse.Result.REJECTED);

            onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got CREATE RESPONSE from tracker`);
                reply(
                    response.createResponse.response,
                    response.createResponse.serverToken,
                    response.createResponse.clientToken
                );
            };
            this.tracker.on('create_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.CreateResponse.Result.TIMEOUT);
                },
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.CreateRequest.create({
                token: this.tracker.getToken(message.createRequest.trackerName),
                daemonName: message.createRequest.daemonName,
                path: message.createRequest.path,
                type: message.createRequest.type,
                encrypted: message.createRequest.encrypted,
                fixed: message.createRequest.fixed,
                connectAddress: message.createRequest.connectAddress,
                connectPort: message.createRequest.connectPort,
                listenAddress: message.createRequest.listenAddress,
                listenPort: message.createRequest.listenPort,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.CREATE_REQUEST,
                messageId: relayId,
                createRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.createRequest.trackerName, data);
        } catch (error) {
            this._daemon._logger.error(new WError(error, 'CreateRequest.handle()'));
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

module.exports = CreateRequest;