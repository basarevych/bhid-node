/**
 * Get Connections Request event
 * @module daemon/events/get-connections-request
 */
const uuid = require('uuid');
const NError = require('nerror');

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

        this._logger.debug('get-connections-request', `Got GET CONNECTIONS REQUEST`);
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
                this._logger.debug('get-connections-request', `Sending GET CONNECTIONS RESPONSE`);
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
                let serverConnections = [];
                for (let connection of Array.from(active.serverConnections.values())) {
                    let data = {
                        name: connection.name,
                        connectAddress: connection.connectAddress,
                        connectPort: connection.connectPort,
                        encrypted: connection.encrypted,
                        fixed: connection.fixed,
                        clients: connection.clients,
                        connected: connection.connected,
                    };
                    let info = this.peer.connections.get(
                        message.getConnectionsRequest.trackerName || this.tracker.default +
                        '#' + connection.name
                    );
                    if (info) {
                        data.listenAddress = info.listenAddress || '*';
                        data.listenPort = info.listenPort || '*';
                    }
                    serverConnections.push(this.daemon.ServerConnection.create(data));
                }

                let clientConnections = [];
                for (let connection of Array.from(active.clientConnections.values())) {
                    let data = {
                        name: connection.name,
                        listenAddress: connection.listenAddress,
                        listenPort: connection.listenPort,
                        encrypted: connection.encrypted,
                        fixed: connection.fixed,
                        server: connection.server,
                        connected: connection.connected,
                    };
                    let info = this.peer.connections.get(
                        message.getConnectionsRequest.trackerName || this.tracker.default +
                        '#' + connection.name
                    );
                    if (info) {
                        data.listenAddress = info.listenAddress || '*';
                        data.listenPort = info.listenPort || '*';
                    }
                    clientConnections.push(this.daemon.ClientConnection.create(data));
                }

                activeList = this.daemon.ConnectionsList.create({ serverConnections, clientConnections });
            }

            let importedList;
            if (imported) {
                let serverConnections = [];
                for (let connection of Array.from(imported.serverConnections.values())) {
                    let data = {
                        name: connection.name,
                        connectAddress: connection.connectAddress,
                        connectPort: connection.connectPort,
                        encrypted: connection.encrypted,
                        fixed: connection.fixed,
                        clients: connection.clients,
                        connected: connection.connected,
                    };
                    serverConnections.push(this.daemon.ServerConnection.create(data));
                }

                let clientConnections = [];
                for (let connection of Array.from(imported.clientConnections.values())) {
                    let data = {
                        name: connection.name,
                        listenAddress: connection.listenAddress,
                        listenPort: connection.listenPort,
                        encrypted: connection.encrypted,
                        fixed: connection.fixed,
                        server: connection.server,
                        connected: connection.connected,
                    };
                    clientConnections.push(this.daemon.ClientConnection.create(data));
                }

                importedList = this.daemon.ConnectionsList.create({ serverConnections, clientConnections });
            }

            reply(this.daemon.GetConnectionsResponse.Result.ACCEPTED, activeList, importedList);
        } catch (error) {
            this._logger.error(new NError(error, 'GetConnectionsRequest.handle()'));
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