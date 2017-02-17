/**
 * Server Available event
 * @module daemon/events/server-available
 */
const debug = require('debug')('bhid:tracker');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Server Available event class
 */
class ServerAvailable {
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
     * Service name is 'modules.tracker.events.serverAvailable'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker.events.serverAvailable';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config' ];
    }

    /**
     * Event handler
     * @param {string} name                     Name of the tracker
     * @param {object} message                  The message
     */
    handle(name, message) {
        let connectionName = name + '#' + message.serverAvailable.connectionName;
        debug(`Got SERVER AVAILABLE for ${connectionName}`);

        let connection = this.peer.connections.get(connectionName);
        if (!connection || connection.server)
            return;

        this.peer.connect(connectionName, 'internal', message.serverAvailable.insternalAddress, message.serverAvailable.insternalPort);
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

module.exports = ServerAvailable;