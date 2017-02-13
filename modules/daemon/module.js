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

        let initRequest = this._app.get('modules.daemon.messages.initRequest');
        server.on('init_request', initRequest.onMessage.bind(initRequest));

        let confirmRequest = this._app.get('modules.daemon.messages.confirmRequest');
        server.on('confirm_request', confirmRequest.onMessage.bind(confirmRequest));

        let createRequest = this._app.get('modules.daemon.messages.createRequest');
        server.on('create_request', createRequest.onMessage.bind(createRequest));

        let deleteRequest = this._app.get('modules.daemon.messages.deleteRequest');
        server.on('delete_request', deleteRequest.onMessage.bind(deleteRequest));

        let connectRequest = this._app.get('modules.daemon.messages.connectRequest');
        server.on('connect_request', connectRequest.onMessage.bind(connectRequest));

        let disconnectRequest = this._app.get('modules.daemon.messages.disconnectRequest');
        server.on('disconnect_request', disconnectRequest.onMessage.bind(disconnectRequest));

        let treeRequest = this._app.get('modules.daemon.messages.treeRequest');
        server.on('tree_request', treeRequest.onMessage.bind(treeRequest));

        return Promise.resolve();
    }
}

module.exports = Daemon;
