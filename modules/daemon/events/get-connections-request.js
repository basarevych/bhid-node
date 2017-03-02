/**
 * Get Connections Request event
 * @module daemon/events/get-connections-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Get Connections Request event class
 */
class GetConnectionsRequest {
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
     * Service name is 'modules.daemon.events.getConnectionsRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.getConnectionsRequest';
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

        debug(`Got GET CONNECTIONS REQUEST`);
        try {
            let reply = (value, activeList, importedList) => {
                let reply = this.daemon.GetConnectionsResponse.create({
                    response: value,
                    activeList: activeList,
                    importedList: importedList,
                });
                let result = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.GET_CONNECTIONS_RESPONSE,
                    getConnectionsResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(result).finish();
                debug(`Sending GET CONNECTIONS RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.getConnectionsRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.GetConnectionsResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.GetConnectionsResponse.Result.NOT_REGISTERED);

            let active = this._connectionsList.get(message.getConnectionsRequest.trackerName || this.tracker.default);
            let imported = this._connectionsList.getImported(message.getConnectionsRequest.trackerName || this.tracker.default);

            let activeList;
            if (active) {
                activeList = this.daemon.ConnectionsList.create({
                    serverConnections: Array.from(active.serverConnections.values()),
                    clientConnections: Array.from(active.clientConnections.values()),
                });
            }
            let importedList;
            if (imported) {
                importedList = this.daemon.ConnectionsList.create({
                    serverConnections: Array.from(imported.serverConnections.values()),
                    clientConnections: Array.from(imported.clientConnections.values()),
                });
            }

            if (activeList) {
                for (let connection of activeList.serverConnections) {
                    let info = this.peer.connections.get(
                        message.getConnectionsRequest.trackerName || this.tracker.default +
                        '#' + connection.name
                    );
                    if (info) {
                        connection.listenAddress = info.listenAddress || '*';
                        connection.listenPort = info.listenPort || '*';
                    }
                }
                for (let connection of activeList.clientConnections) {
                    let info = this.peer.connections.get(
                        message.getConnectionsRequest.trackerName || this.tracker.default +
                        '#' + connection.name
                    );
                    if (info) {
                        connection.listenAddress = info.listenAddress || '*';
                        connection.listenPort = info.listenPort || '*';
                    }
                }
            }

            reply(this.daemon.GetConnectionsResponse.Result.ACCEPTED, activeList, importedList);
        } catch (error) {
            this._logger.error(new WError(error, 'GetConnectionsRequest.handle()'));
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

    /**
     * Retrieve peer server
     * @return {Peer}
     */
    get peer() {
        if (this._peer)
            return this._peer;
        this._peer = this._app.get('servers').get('peer');
        return this._peer;
    }
}

module.exports = GetConnectionsRequest;