/**
 * Daemon module
 * @module daemon/module
 */
const path = require('path');

/**
 * Module main class
 */
class Daemon {
    /**
     * Create the module
     * @param {App} app             The application
     * @param {object} config       Configuration
     * @param {Logger} logger       Logger service
     */
    constructor(app, config, logger) {
        this._app = app;
        this._config = config;
        this._logger = logger;
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
        return [ 'app', 'config', 'logger' ];
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

        let createDaemonRequest = this._app.get('modules.daemon.events.createDaemonRequest');
        server.on('create_daemon_request', createDaemonRequest.handle.bind(createDaemonRequest));

        let setTokenRequest = this._app.get('modules.daemon.events.setTokenRequest');
        server.on('set_token_request', setTokenRequest.handle.bind(setTokenRequest));

        let createRequest = this._app.get('modules.daemon.events.createRequest');
        server.on('create_request', createRequest.handle.bind(createRequest));

        let deleteRequest = this._app.get('modules.daemon.events.deleteRequest');
        server.on('delete_request', deleteRequest.handle.bind(deleteRequest));

        let importRequest = this._app.get('modules.daemon.events.importRequest');
        server.on('import_request', importRequest.handle.bind(importRequest));

        let attachRequest = this._app.get('modules.daemon.events.attachRequest');
        server.on('attach_request', attachRequest.handle.bind(attachRequest));

        let detachRequest = this._app.get('modules.daemon.events.detachRequest');
        server.on('detach_request', detachRequest.handle.bind(detachRequest));

        let treeRequest = this._app.get('modules.daemon.events.treeRequest');
        server.on('tree_request', treeRequest.handle.bind(treeRequest));

        let connectionsListRequest = this._app.get('modules.daemon.events.connectionsListRequest');
        server.on('connections_list_request', connectionsListRequest.handle.bind(connectionsListRequest));

        let setConnectionsRequest = this._app.get('modules.daemon.events.setConnectionsRequest');
        server.on('set_connections_request', setConnectionsRequest.handle.bind(setConnectionsRequest));

        let getConnectionsRequest = this._app.get('modules.daemon.events.getConnectionsRequest');
        server.on('get_connections_request', getConnectionsRequest.handle.bind(getConnectionsRequest));

        let importConnectionsRequest = this._app.get('modules.daemon.events.importConnectionsRequest');
        server.on('import_connections_request', importConnectionsRequest.handle.bind(importConnectionsRequest));

        let updateConnectionsRequest = this._app.get('modules.daemon.events.updateConnectionsRequest');
        server.on('update_connections_request', updateConnectionsRequest.handle.bind(updateConnectionsRequest));

        let redeemMasterRequest = this._app.get('modules.daemon.events.redeemMasterRequest');
        server.on('redeem_master_request', redeemMasterRequest.handle.bind(redeemMasterRequest));

        let redeemDaemonRequest = this._app.get('modules.daemon.events.redeemDaemonRequest');
        server.on('redeem_daemon_request', redeemDaemonRequest.handle.bind(redeemDaemonRequest));

        let redeemPathRequest = this._app.get('modules.daemon.events.redeemPathRequest');
        server.on('redeem_path_request', redeemPathRequest.handle.bind(redeemPathRequest));

        return Promise.resolve();
    }
}

module.exports = Daemon;
