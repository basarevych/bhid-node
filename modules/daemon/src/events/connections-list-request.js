/**
 * Connections List Request event
 * @module daemon/events/connections-list-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Connection List Request event class
 */
class ConnectionsListRequest extends Base {
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
     * Service name is 'daemon.events.connectionsListRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.connectionsListRequest';
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
        return 'connections_list_request';
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

        this._logger.debug('connections-list-request', `Got CONNECTIONS LIST REQUEST`);
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
                this._logger.debug('connections-list-request', `Sending CONNECTIONS LIST RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.connectionsListRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.ConnectionsListResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.ConnectionsListResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('connections-list-request', `Got CONNECTIONS LIST RESPONSE from tracker`);
                reply(response.connectionsListResponse.response, response.connectionsListResponse.list);
            };
            this.tracker.on('connections_list_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.ConnectionsListResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.CONNECTIONS_LIST_REQUEST,
                messageId: relayId,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.connectionsListRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'ConnectionsListRequest.handle()'));
        }
    }
}

module.exports = ConnectionsListRequest;
