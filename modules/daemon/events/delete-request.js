/**
 * Delete Request event
 * @module daemon/events/delete-request
 */
const uuid = require('uuid');
const NError = require('nerror');

/**
 * Delete Request event class
 */
class DeleteRequest {
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
     * Service name is 'modules.daemon.events.deleteRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.deleteRequest';
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

        this._logger.debug('delete-request', `Got DELETE REQUEST`);
        this.tracker.getMasterToken(message.deleteRequest.trackerName)
            .then(masterToken => {
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
                    () => {
                        reply(this.daemon.DeleteResponse.Result.TIMEOUT);
                    },
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
            })
            .catch(error => {
                this._logger.error(new NError(error, 'DeleteRequest.handle()'));
            });
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

module.exports = DeleteRequest;