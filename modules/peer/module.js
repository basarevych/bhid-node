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
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Connect} connect                     Connect event handler
     * @param {ConnectRequest} connectRequest       ConnectRequest event handler
     * @param {ConnectResponse} connectResponse     ConnectResponse event handler
     * @param {Established} established             Established event handler
     * @param {Data} data                           Data event handler
     */
    constructor(app, config, connect, connectRequest, connectResponse, established, data) {
        this._app = app;
        this._config = config;
        this._connect = connect;
        this._connectRequest = connectRequest;
        this._connectResponse = connectResponse;
        this._established = established;
        this._data = data;
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
        return [
            'app',
            'config',
            'modules.peer.events.connect',
            'modules.peer.events.connectRequest',
            'modules.peer.events.connectResponse',
            'modules.peer.events.established',
            'modules.peer.events.data',
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
        if (this._config.get(`servers.${name}.class`) !== 'servers.peer')
            return Promise.resolve();

        let server = this._app.get('servers').get('peer');

        server.on('connect', this._connect.handle.bind(this._connect));
        server.on('connect_request', this._connectRequest.handle.bind(this._connectRequest));
        server.on('connect_response', this._connectResponse.handle.bind(this._connectResponse));
        server.on('established', this._established.handle.bind(this._established));
        server.on('data', this._data.handle.bind(this._data));

        return Promise.resolve();
    }
}

module.exports = Peer;
