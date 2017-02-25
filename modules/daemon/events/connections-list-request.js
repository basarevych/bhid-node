/**
 * Connections List Request event
 * @module daemon/events/connections-list-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Connection List Request event class
 */
class ConnectionsListRequest {
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
     * Service name is 'modules.daemon.events.connectionsListRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.connectionsListRequest';
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

        debug(`Got CONNECTIONS LIST REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, list) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('connections_list_response', onResponse);

                let reply = this.daemon.ConnectionsListResponse.create({
                    response: value,
                    list: list,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.CONNECTIONS_LIST_RESPONSE,
                    connectionsListResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                debug(`Sending CONNECTIONS LIST RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.servers.get(message.connectionsListRequest.trackerName || this.tracker.default);
            if (!server)
                return reply(this.daemon.ConnectionsListResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.ConnectionsListResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got CONNECTIONS LIST RESPONSE from tracker`);
                reply(response.connectionsListResponse.response, response.connectionsListResponse.list);
            };
            this.tracker.on('connections_list_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.ConnectionsListResponse.Result.TIMEOUT);
                },
                this.daemon.constructor.requestTimeout
            );

            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.CONNECTIONS_LIST_REQUEST,
                messageId: relayId,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.connectionsListRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new WError(error, 'ConnectionsListRequest.handle()'));
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

module.exports = ConnectionsListRequest;