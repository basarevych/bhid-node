/**
 * Delete Request event
 * @module daemon/events/delete-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Delete Request event class
 */
class DeleteRequest extends Base {
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
     * Service name is 'daemon.events.deleteRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.deleteRequest';
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
        return 'delete_request';
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

        this._logger.debug('delete-request', `Got DELETE REQUEST`);
        try {
            let masterToken = await this.tracker.getMasterToken(message.deleteRequest.trackerName);
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = value => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('delete_response', onResponse);

                let reply = this.daemon.DeleteResponse.create({
                    response: value,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.DELETE_RESPONSE,
                    deleteResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('delete-request', `Sending DELETE RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.deleteRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.DeleteResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.DeleteResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('delete-request', `Got DELETE RESPONSE from tracker`);
                reply(response.deleteResponse.response);
            };
            this.tracker.on('delete_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.DeleteResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.DeleteRequest.create({
                token: masterToken,
                path: message.deleteRequest.path,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.DELETE_REQUEST,
                messageId: relayId,
                deleteRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.deleteRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'DeleteRequest.handle()'));
        }
    }
}

module.exports = DeleteRequest;
