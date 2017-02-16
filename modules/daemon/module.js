/**
 * Daemon module
 * @module daemon/module
 */


/**
 * Module main class
 */
class Daemon {
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
     * Service name is 'modules.daemon'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon';
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
        if (this._config.get(`servers.${name}.class`) != 'servers.daemon')
            return Promise.resolve();

        let server = this._app.get('servers').get('daemon');

        let initRequest = this._app.get('modules.daemon.events.initRequest');
        server.on('init_request', initRequest.handle.bind(initRequest));

        let confirmRequest = this._app.get('modules.daemon.events.confirmRequest');
        server.on('confirm_request', confirmRequest.handle.bind(confirmRequest));

        let setTokenRequest = this._app.get('modules.daemon.events.setTokenRequest');
        server.on('set_token_request', setTokenRequest.handle.bind(setTokenRequest));

        let createRequest = this._app.get('modules.daemon.events.createRequest');
        server.on('create_request', createRequest.handle.bind(createRequest));

        let deleteRequest = this._app.get('modules.daemon.events.deleteRequest');
        server.on('delete_request', deleteRequest.handle.bind(deleteRequest));

        let connectRequest = this._app.get('modules.daemon.events.connectRequest');
        server.on('connect_request', connectRequest.handle.bind(connectRequest));

        let disconnectRequest = this._app.get('modules.daemon.events.disconnectRequest');
        server.on('disconnect_request', disconnectRequest.handle.bind(disconnectRequest));

        let treeRequest = this._app.get('modules.daemon.events.treeRequest');
        server.on('tree_request', treeRequest.handle.bind(treeRequest));

        let connectionsListRequest = this._app.get('modules.daemon.events.connectionsListRequest');
        server.on('connections_list_request', connectionsListRequest.handle.bind(connectionsListRequest));

        let setConnectionsRequest = this._app.get('modules.daemon.events.setConnectionsRequest');
        server.on('set_connections_request', setConnectionsRequest.handle.bind(setConnectionsRequest));

        return Promise.resolve();
    }
}

module.exports = Daemon;
