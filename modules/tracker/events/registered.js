/**
 * Registered event
 * @module tracker/events/registered
 */
const uuid = require('uuid');
const NError = require('nerror');

/**
 * Registered event class
 */
class Registered {
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
     * Service name is 'modules.tracker.events.registered'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker.events.registered';
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
     * @param {string} name                     Name of the tracker
     */
    handle(name) {
        let server = this.tracker.servers.get(name);
        if (!server)
            return;

        let trackedConnections = this._connectionsList.get(name);
        if (!trackedConnections)
            return;

        let merged = new Map([ ...trackedConnections.serverConnections, ...trackedConnections.clientConnections ]);
        for (let connectionName of merged.keys()) {
            let info = this.peer.connections.get(name + '#' + connectionName);
            if (info)
                this.tracker.sendStatus(name, connectionName);
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

module.exports = Registered;