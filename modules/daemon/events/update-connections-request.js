/**
 * Update Connections Request event
 * @module daemon/events/update-connections-request
 */
const uuid = require('uuid');
const WError = require('verror').WError;

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

            for (let connection of message.updateConnectionsRequest.list.serverConnections) {
                this._connectionsList.update(
                    message.updateConnectionsRequest.trackerName || this.tracker.default,
                    connection.name,
                    true,
                    connection
                );
            }
            for (let connection of message.updateConnectionsRequest.list.clientConnections) {
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
            this._logger.error(new WError(error, 'UpdateConnectionsRequest.handle()'));
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