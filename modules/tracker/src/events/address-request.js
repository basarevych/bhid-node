/**
 * Address Request event
 * @module tracker/events/address-request
 */
const uuid = require('uuid');
const utp = require('utp-punch');
const NError = require('nerror');
const Base = require('./base');

/**
 * Address Request event class
 */
class AddressRequest extends Base {
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
     * Service name is 'tracker.events.addressRequest'
     * @type {string}
     */
    static get provides() {
        return 'tracker.events.addressRequest';
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
        return 'address_request';
    }

    /**
     * Event handler
     * @param {string} name                     Name of the tracker
     * @param {object} message                  The message
     * @return {Promise}
     */
    async handle(name, message) {
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
}

module.exports = AddressRequest;
