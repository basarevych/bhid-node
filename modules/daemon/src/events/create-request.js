/**
 * Create Request event
 * @module daemon/events/create-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Create Request event class
 */
class CreateRequest extends Base {
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
     * Service name is 'daemon.events.createRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.createRequest';
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
        return 'create_request';
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

        this._logger.debug('create-request', `Got CREATE REQUEST`);
        try {
            let masterToken = await this.tracker.getMasterToken(message.createRequest.trackerName);
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, serverToken, clientToken, updates) => {
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
                    updates: updates,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.CREATE_RESPONSE,
                    createResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('create-request', `Sending CREATE RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.createRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.CreateResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.CreateResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('create-request', `Got CREATE RESPONSE from tracker`);
                reply(
                    response.createResponse.response,
                    response.createResponse.serverToken,
                    response.createResponse.clientToken,
                    response.createResponse.updates
                );
            };
            this.tracker.on('create_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.CreateResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.CreateRequest.create({
                token: masterToken,
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
            this._logger.error(new NError(error, 'CreateRequest.handle()'));
        }
    }
}

module.exports = CreateRequest;
