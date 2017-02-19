/**
 * Tracker module
 * @module tracker/module
 */


/**
 * Module main class
 */
class Tracker {
    /**
     * Create the module
     * @param {App} app             The application
     * @param {object} config       Configuration
     */
    constructor(app, config) {
        this._app = app;
        this._config = config;
    }

    /**
     * Service name is 'modules.tracker'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config' ];
    }

    /**
     * Bootstrap the module
     * @return {Promise}
     */
    bootstrap() {
        return Promise.resolve();
    }

    /**
     * Register with the server
     * @param {string} name                     Server name as in config
     * @return {Promise}
     */
    register(name) {
        if (this._config.get(`servers.${name}.class`) != 'servers.tracker')
            return Promise.resolve();

        let server = this._app.get('servers').get('tracker');

        let connection = this._app.get('modules.tracker.events.connection');
        server.on('connection', connection.handle.bind(connection));
        server.on('token', connection.handle.bind(connection));

        let registration = this._app.get('modules.tracker.events.registration');
        server.on('registration', registration.handle.bind(registration));

        let serverAvailable = this._app.get('modules.tracker.events.serverAvailable');
        server.on('server_available', serverAvailable.handle.bind(serverAvailable));

        let addressRequest = this._app.get('modules.tracker.events.addressRequest');
        server.on('address_request', addressRequest.handle.bind(addressRequest));

        let peerAvailable = this._app.get('modules.tracker.events.peerAvailable');
        server.on('peer_available', peerAvailable.handle.bind(peerAvailable));

        return Promise.resolve();
    }
}

module.exports = Tracker;
