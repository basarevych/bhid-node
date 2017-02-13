/**
 * Delete Request message
 * @module daemon/messages/delete-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Delete Request message class
 */
class DeleteRequest {
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
     * Service name is 'modules.daemon.messages.deleteRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.messages.deleteRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config' ];
    }

    /**
     * Message handler
     * @param {string} id           ID of the client
     * @param {object} message      The message
     */
    onMessage(id, message) {
        let client = this.daemon.clients.get(id);
        if (!client)
            return;

        debug(`Got DELETE REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer;
            let reply = value => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                this.tracker.removeListener('delete_response', onResponse);

                let reply = this.daemon.DeleteResponse.create({
                    response: value,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.DELETE_RESPONSE,
                    deleteResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                debug(`Sending DELETE RESPONSE`);
                this.daemon.send(id, data);
            };

            if (!this.tracker.getToken(message.deleteRequest.trackerName))
                return reply(this.daemon.DeleteResponse.Result.REJECTED);

            let onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got DELETE RESPONSE from tracker`);
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
                token: this.tracker.getToken(message.deleteRequest.trackerName),
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
            this._daemon._logger.error(new WError(error, 'DeleteRequest.onMessage()'));
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

module.exports = DeleteRequest;