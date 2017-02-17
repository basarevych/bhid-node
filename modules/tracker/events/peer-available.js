/**
 * Peer Available event
 * @module tracker/events/peer-available
 */
const debug = require('debug')('bhid:tracker');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Peer Available event class
 */
class PeerAvailable {
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
     * Service name is 'modules.tracker.events.peerAvailable'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker.events.peerAvailable';
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
     * @param {string} name                     Name of the tracker
     * @param {object} message                  The message
     */
    handle(name, message) {
        let connectionName = name + '#' + message.peerAvailable.connectionName;
        debug(`Got PEER AVAILABLE for ${connectionName}`);

        let connection = this.peer.connections.get(connectionName);
        if (!connection)
            return;

        if (connection.server) {
            debug(`Punching ${name}: ${message.peerAvailable.externalAddress}:${message.peerAvailable.externalPort}`);
            connection.utp.punch(
                this.peer.constructor.punchingAttempts,
                message.peerAvailable.externalPort,
                message.peerAvailable.externalAddress
            );
        } else {
            this.peer.connect(
                connectionName,
                'external',
                message.peerAvailable.externalAddress,
                message.peerAvailable.externalPort
            );
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

module.exports = PeerAvailable;