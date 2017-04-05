/**
 * Tracker module
 * @module peer/module
 */


/**
 * Module main class
 */
class Peer {
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
     * Service name is 'modules.peer'
     * @type {string}
     */
    static get provides() {
        return 'modules.peer';
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
        if (this._config.get(`servers.${name}.class`) !== 'servers.peer')
            return Promise.resolve();

        let server = this._app.get('servers').get('peer');

        let connection = this._app.get('modules.peer.events.connection');
        server.on('connection', connection.handle.bind(connection));

        let connectRequest = this._app.get('modules.peer.events.connectRequest');
        server.on('connect_request', connectRequest.handle.bind(connectRequest));

        let connectResponse = this._app.get('modules.peer.events.connectResponse');
        server.on('connect_response', connectResponse.handle.bind(connectResponse));

        let established = this._app.get('modules.peer.events.established');
        server.on('established', established.handle.bind(established));

        let data = this._app.get('modules.peer.events.data');
        server.on('data', data.handle.bind(data));

        return Promise.resolve();
    }
}

module.exports = Peer;
