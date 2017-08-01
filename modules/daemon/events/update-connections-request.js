/**
 * Update Connections Request event
 * @module daemon/events/update-connections-request
 */
const uuid = require('uuid');
const NError = require('nerror');

/**
 * Update Connections Request event class
 */
class UpdateConnectionsRequest {
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
     * Service name is 'modules.daemon.events.updateConnectionsRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.updateConnectionsRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'connectionsList' ];
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

        this._logger.debug('update-connections-request', `Got UPDATE CONNECTIONS REQUEST`);
        try {
            let reply = value => {
                let reply = this.daemon.UpdateConnectionsResponse.create({
                    response: value,
                });
                let result = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.UPDATE_CONNECTIONS_RESPONSE,
                    updateConnectionsResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(result).finish();
                this._logger.debug('update-connections-request', `Sending UPDATE CONNECTIONS RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.updateConnectionsRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.UpdateConnectionsResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.UpdateConnectionsResponse.Result.NOT_REGISTERED);

            let acceptPath = message.updateConnectionsRequest.path;
            if (acceptPath && acceptPath[0] === '/')
                acceptPath = server.email + acceptPath;

            for (let connection of message.updateConnectionsRequest.list.serverConnections) {
                if (acceptPath && acceptPath !== connection.path)
                    continue;

                this._connectionsList.update(
                    message.updateConnectionsRequest.trackerName || this.tracker.default,
                    connection.name,
                    true,
                    connection
                );
            }

            for (let connection of message.updateConnectionsRequest.list.clientConnections) {
                if (acceptPath && acceptPath !== connection.path)
                    continue;

                this._connectionsList.update(
                    message.updateConnectionsRequest.trackerName || this.tracker.default,
                    connection.name,
                    false,
                    connection
                );
            }

            if (this._connectionsList.save())
                reply(this.daemon.UpdateConnectionsResponse.Result.ACCEPTED);
            else
                reply(this.daemon.UpdateConnectionsResponse.Result.REJECTED);
        } catch (error) {
            this._logger.error(new NError(error, 'UpdateConnectionsRequest.handle()'));
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

module.exports = UpdateConnectionsRequest;