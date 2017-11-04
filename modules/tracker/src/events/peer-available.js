/**
 * Peer Available event
 * @module tracker/events/peer-available
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Peer Available event class
 */
class PeerAvailable extends Base {
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
     * Service name is 'tracker.events.peerAvailable'
     * @type {string}
     */
    static get provides() {
        return 'tracker.events.peerAvailable';
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
        return 'peer_available';
    }

    /**
     * Event handler
     * @param {string} name                     Name of the tracker
     * @param {object} message                  The message
     * @return {Promise}
     */
    async handle(name, message) {
        try {
            let connectionName = name + '#' + message.peerAvailable.connectionName;
            this._logger.debug('peer-available', `Got PEER AVAILABLE for ${connectionName}`);

            let connection = this.peer.connections.get(connectionName);
            if (!connection || this.peer._closing)
                return;

            if (connection.server) {
                this._logger.debug('peer-available', `Punching ${connectionName}: ${message.peerAvailable.externalAddress}:${message.peerAvailable.externalPort}`);
                this.peer.utp.punch(
                    this.peer.constructor.punchingAttempts,
                    message.peerAvailable.externalPort,
                    message.peerAvailable.externalAddress
                );
            } else {
                connection.external = {
                    address: message.peerAvailable.externalAddress,
                    port: message.peerAvailable.externalPort,
                };

                this.peer.connect(
                    name,
                    message.peerAvailable.connectionName,
                    'external'
                );
            }
        } catch (error) {
            this._logger.error(new NError(error, 'PeerAvailable.handle()'));
        }
    }
}

module.exports = PeerAvailable;
