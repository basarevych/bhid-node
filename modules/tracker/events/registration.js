/**
 * Registration event
 * @module tracker/events/registration
 */
const debug = require('debug')('bhid:tracker');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Registration event class
 */
class Registration {
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
     * Service name is 'modules.tracker.events.registration'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker.events.registration';
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
     * @param {string} name                     Name of the tracker
     */
    handle(name) {
        let server = this.tracker.servers.get(name);
        if (!server)
            return;

        for (let [ tracker, connections ] of this._connectionsList.list) {
            if (tracker != name)
                continue;

            for (let connection of connections.serverConnections) {
                let info = this.peer.connections.get(tracker + '#' + connection.name);
                if (!info)
                    continue;
                let address = info.utp.getUdpSocket().address();
                if (!address)
                    continue;

                this.tracker.sendStatus(
                    tracker,
                    connection.name,
                    connection.connected,
                    server.socket.remoteAddress,
                    address.port
                );
            }
            for (let connection of connections.clientConnections) {
                let info = this.peer.connections.get(tracker + '#' + connection.name);
                if (!info)
                    continue;

                this.tracker.sendStatus(
                    tracker,
                    connection.name,
                    connection.connected
                );
            }
        }
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

module.exports = Registration;