/**
 * Peer Available event
 * @module tracker/events/peer-available
 */
const uuid = require('uuid');
const NError = require('nerror');

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
        this._logger.debug('peer-available', `Got PEER AVAILABLE for ${connectionName}`);

        let connection = this.peer.connections.get(connectionName);
        if (!connection || !this.peer._utpRunning)
            return;

        if (connection.server) {
            this._logger.debug('peer-available', `Punching ${connectionName}: ${message.peerAvailable.externalAddress}:${message.peerAvailable.externalPort}`);
            this.peer.utp.punch(
                this.peer.constructor.punchingAttempts,
                message.peerAvailable.externalPort,
                message.peerAvailable.externalAddress
            );
        } else {
            this.peer.connect(
                name,
                message.peerAvailable.connectionName,
                'external',
                [
                    {
                        address: message.peerAvailable.externalAddress,
                        port: message.peerAvailable.externalPort,
                    },
                ]
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