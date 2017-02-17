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
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, connectionsList) {
        this._app = app;
        this._config = config;
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
        return [ 'app', 'config', 'modules.peer.connectionsList' ];
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

            for (let connection of connections.serverConnections.concat(connections.clientConnections)) {
                let info = this.peer.connections.get(tracker + '#' + connection.name);
                if (!info || !info.utp)
                    continue;

                try {
                    debug(`Sending STATUS of ${connection.name} to ${tracker}`);
                    let status = this.tracker.Status.create({
                        connectionName: connection.name,
                        connected: connection.connected,
                        internalAddress: info.utp.getUdpSocket().address().address,
                        internalPort: info.utp.getUdpSocket().address().port.toString(),
                    });
                    let message = this.tracker.ClientMessage.create({
                        type: this.tracker.ClientMessage.Type.STATUS,
                        status: status,
                    });
                    let buffer = this.tracker.ClientMessage.encode(message).finish();
                    this.tracker.send(tracker, buffer);
                } catch (error) {
                    this.tracker._logger.error(new WError(error, `Registration.handle()`));
                }
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