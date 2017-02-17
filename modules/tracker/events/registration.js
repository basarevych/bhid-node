/**
 * Registration event
 * @module tracker/events/registration
 */
const debug = require('debug')('bhid:peer');
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
                try {
                    debug(`Sending STATUS of ${connection.name} to ${tracker}`);
                    let status = this.tracker.Status.create({
                        connectionName: connection.name,
                        connected: connection.connected,
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
     * Retrieve daemon server
     * @return {Daemon}
     */
    get daemon() {
        if (this._daemon)
            return this._daemon;
        this._daemon = this._app.get('servers').get('daemon');
        return this._daemon;
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
}

module.exports = Registration;