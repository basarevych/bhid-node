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
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Connect} connect                     Connect event handler
     * @param {Registered} registered               Registered event handler
     * @param {ServerAvailable} serverAvailable     ServerAvailable event handler
     * @param {AddressRequest} addressRequest       AddressRequest event handler
     * @param {PeerAvailable} peerAvailable         PeerAvailable event handler
     * @param {ConnectionsList} connectionsList     ConnectionsList event handler
     */
    constructor(app, config, connect, registered, serverAvailable, addressRequest, peerAvailable, connectionsList) {
        this._app = app;
        this._config = config;
        this._connect = connect;
        this._registered = registered;
        this._serverAvailable = serverAvailable;
        this._addressRequest = addressRequest;
        this._peerAvailable = peerAvailable;
        this._connectionsList = connectionsList;
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
        return [
            'app',
            'config',
            'modules.tracker.events.connect',
            'modules.tracker.events.registered',
            'modules.tracker.events.serverAvailable',
            'modules.tracker.events.addressRequest',
            'modules.tracker.events.peerAvailable',
            'modules.tracker.events.connectionsList',
        ];
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
        if (this._config.get(`servers.${name}.class`) !== 'servers.tracker')
            return Promise.resolve();

        let server = this._app.get('servers').get('tracker');

        server.on('connect', this._connect.handle.bind(this._connect));
        server.on('token', this._connect.handle.bind(this._connect));
        server.on('registered', this._registered.handle.bind(this._registered));
        server.on('server_available', this._serverAvailable.handle.bind(this._serverAvailable));
        server.on('address_request', this._addressRequest.handle.bind(this._addressRequest));
        server.on('peer_available', this._peerAvailable.handle.bind(this._peerAvailable));
        server.on('connections_list', this._connectionsList.handle.bind(this._connectionsList));

        return Promise.resolve();
    }
}

module.exports = Tracker;
