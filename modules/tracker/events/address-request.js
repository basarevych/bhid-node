/**
 * Address Request event
 * @module tracker/events/address-request
 */
const uuid = require('uuid');
const utp = require('utp-punch');
const NError = require('nerror');

/**
 * Address Request event class
 */
class AddressRequest {
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
     * Service name is 'modules.tracker.events.addressRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker.events.addressRequest';
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
        let connectionName = name + '#' + message.addressRequest.connectionName;
        this._logger.debug('address-request', `Got ADDRESS REQUEST for ${connectionName}`);

        let connection = this.peer.connections.get(connectionName);
        if (!connection)
            return;

        let tracker = this.tracker.servers.get(connection.tracker);
        if (!tracker)
            return;

        try {
            let response = this.tracker.AddressResponse.create({
                requestId: message.addressRequest.requestId,
            });
            let msg = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.ADDRESS_RESPONSE,
                addressResponse: response,
            });
            let data = this.tracker.ClientMessage.encode(msg).finish();
            this._logger.debug('address-request', `Sending ADDRESS RESPONSE to ${connection.tracker}`);
            this.peer.utp.getUdpSocket().send(
                data,
                tracker.socket.remotePort,
                tracker.socket.remoteAddress
            );
        } catch (error) {
            this._logger.error(new NError(error, 'AddressRequest.handle()'));
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

module.exports = AddressRequest;