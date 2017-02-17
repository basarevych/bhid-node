/**
 * Address Request event
 * @module tracker/events/address-request
 */
const debug = require('debug')('bhid:tracker');
const uuid = require('uuid');
const utp = require('utp-punch');
const WError = require('verror').WError;

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
        debug(`Got ADDRESS REQUEST for ${connectionName}`);

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
            debug(`Sending ADDRESS RESPONSE to ${connection.tracker}`);
            if (connection.server) {
                connection.utp.getUdpSocket().send(
                    data,
                    tracker.socket.remotePort,
                    tracker.socket.remoteAddress
                );
            } else {
                this.bind(connection, () => {
                    connection.utp.getUdpSocket().send(
                        data,
                        tracker.socket.remotePort,
                        tracker.socket.remoteAddress
                    );
                });
            }
        } catch (error) {
            this._logger.error(new WError(error, 'AddressRequest.handle()'));
        }
    }

    /**
     * Bind UTP socket and run callback
     * @param {object} connection               Connection object
     * @param {function} cb                     Callback
     */
    bind(connection, cb) {
        if (connection._binding)
            return;

        connection._binding = true;
        connection.utp = utp.createClient();
        connection.utp.once('error', error => {
            connection.utp = null;
            delete connection._binding;
            setTimeout(() => {
                this.bind(connection, cb);
            }, 1000);
        });
        connection.utp.once('bound', () => {
            delete connection._binding;
            cb();
        });

        connection.utp.bind();
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