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
     * @param {App} app                                             The application
     * @param {object} config                                       Configuration
     * @param {Logger} logger                                       Logger service
     * @param {InitRequest} initRequest                             InitRequest event handler
     * @param {ConfirmRequest} confirmRequest                       ConfirmRequest event handler
     * @param {CreateDaemonRequest} createDaemonRequest             CreateDaemonRequest event handler
     * @param {DeleteDaemonRequest} deleteDaemonRequest             DeleteDaemonRequest event handler
     * @param {SetTokenRequest} setTokenRequest                     SetTokenRequest event handler
     * @param {CreateRequest} createRequest                         CreateRequest event handler
     * @param {DeleteRequest} deleteRequest                         DeleteRequest event handler
     * @param {ImportRequest} importRequest                         ImportRequest event handler
     * @param {AttachRequest} attachRequest                         AttachRequest event handler
     * @param {RemoteAttachRequest} remoteAttachRequest             RemoteAttachRequest event handler
     * @param {DetachRequest} detachRequest                         DetachRequest event handler
     * @param {RemoteDetachRequest} remoteDetachRequest             RemoteDetachRequest event handler
     * @param {TreeRequest} treeRequest                             TreeRequest event handler
     * @param {ConnectionsListRequest} connectionsListRequest       ConnectionsListRequest event handler
     * @param {DaemonsListRequest} daemonsListRequest               DaemonsListRequest event handler
     * @param {SetConnectionsRequest} setConnectionsRequest         SetConnectionsRequest event handler
     * @param {GetConnectionsRequest} getConnectionsRequest         GetConnectionsRequest event handler
     * @param {ImportConnectionsRequest} importConnectionsRequest   ImportConnectionsRequest event handler
     * @param {UpdateConnectionsRequest} updateConnectionsRequest   UpdateConnectionsRequest event handler
     * @param {RedeemMasterRequest} redeemMasterRequest             RedeemMasterRequest event handler
     * @param {RedeemDaemonRequest} redeemDaemonRequest             RedeemDaemonRequest event handler
     * @param {RedeemPathRequest} redeemPathRequest                 RedeemPathRequest event handler
     */
    constructor(app, config, logger, initRequest, confirmRequest, createDaemonRequest, deleteDaemonRequest, setTokenRequest,
        createRequest, deleteRequest, importRequest, attachRequest, remoteAttachRequest, detachRequest, remoteDetachRequest,
        treeRequest, connectionsListRequest, daemonsListRequest, setConnectionsRequest, getConnectionsRequest,
        importConnectionsRequest, updateConnectionsRequest, redeemMasterRequest, redeemDaemonRequest, redeemPathRequest)
    {
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._initRequest = initRequest;
        this._confirmRequest = confirmRequest;
        this._createDaemonRequest = createDaemonRequest;
        this._deleteDaemonRequest = deleteDaemonRequest;
        this._setTokenRequest = setTokenRequest;
        this._createRequest = createRequest;
        this._deleteRequest = deleteRequest;
        this._importRequest = importRequest;
        this._attachRequest = attachRequest;
        this._remoteAttachRequest = remoteAttachRequest;
        this._detachRequest = detachRequest;
        this._remoteDetachRequest = remoteDetachRequest;
        this._treeRequest = treeRequest;
        this._connectionsListRequest = connectionsListRequest;
        this._daemonsListRequest = daemonsListRequest;
        this._setConnectionsRequest = setConnectionsRequest;
        this._getConnectionsRequest = getConnectionsRequest;
        this._importConnectionsRequest = importConnectionsRequest;
        this._updateConnectionsRequest = updateConnectionsRequest;
        this._redeemMasterRequest = redeemMasterRequest;
        this._redeemDaemonRequest = redeemDaemonRequest;
        this._redeemPathRequest = redeemPathRequest;
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
        return [
            'app',
            'config',
            'logger',
            'modules.daemon.events.initRequest',
            'modules.daemon.events.confirmRequest',
            'modules.daemon.events.createDaemonRequest',
            'modules.daemon.events.deleteDaemonRequest',
            'modules.daemon.events.setTokenRequest',
            'modules.daemon.events.createRequest',
            'modules.daemon.events.deleteRequest',
            'modules.daemon.events.importRequest',
            'modules.daemon.events.attachRequest',
            'modules.daemon.events.remoteAttachRequest',
            'modules.daemon.events.detachRequest',
            'modules.daemon.events.remoteDetachRequest',
            'modules.daemon.events.treeRequest',
            'modules.daemon.events.connectionsListRequest',
            'modules.daemon.events.daemonsListRequest',
            'modules.daemon.events.setConnectionsRequest',
            'modules.daemon.events.getConnectionsRequest',
            'modules.daemon.events.importConnectionsRequest',
            'modules.daemon.events.updateConnectionsRequest',
            'modules.daemon.events.redeemMasterRequest',
            'modules.daemon.events.redeemDaemonRequest',
            'modules.daemon.events.redeemPathRequest',
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
        if (this._config.get(`servers.${name}.class`) !== 'servers.daemon')
            return Promise.resolve();

        let server = this._app.get('servers').get('daemon');

        server.on('init_request', this._initRequest.handle.bind(this._initRequest));
        server.on('confirm_request', this._confirmRequest.handle.bind(this._confirmRequest));
        server.on('create_daemon_request', this._createDaemonRequest.handle.bind(this._createDaemonRequest));
        server.on('delete_daemon_request', this._deleteDaemonRequest.handle.bind(this._deleteDaemonRequest));
        server.on('set_token_request', this._setTokenRequest.handle.bind(this._setTokenRequest));
        server.on('create_request', this._createRequest.handle.bind(this._createRequest));
        server.on('delete_request', this._deleteRequest.handle.bind(this._deleteRequest));
        server.on('import_request', this._importRequest.handle.bind(this._importRequest));
        server.on('attach_request', this._attachRequest.handle.bind(this._attachRequest));
        server.on('remote_attach_request', this._remoteAttachRequest.handle.bind(this._remoteAttachRequest));
        server.on('detach_request', this._detachRequest.handle.bind(this._detachRequest));
        server.on('remote_detach_request', this._remoteDetachRequest.handle.bind(this._remoteDetachRequest));
        server.on('tree_request', this._treeRequest.handle.bind(this._treeRequest));
        server.on('connections_list_request', this._connectionsListRequest.handle.bind(this._connectionsListRequest));
        server.on('daemons_list_request', this._daemonsListRequest.handle.bind(this._daemonsListRequest));
        server.on('set_connections_request', this._setConnectionsRequest.handle.bind(this._setConnectionsRequest));
        server.on('get_connections_request', this._getConnectionsRequest.handle.bind(this._getConnectionsRequest));
        server.on('import_connections_request', this._importConnectionsRequest.handle.bind(this._importConnectionsRequest));
        server.on('update_connections_request', this._updateConnectionsRequest.handle.bind(this._updateConnectionsRequest));
        server.on('redeem_master_request', this._redeemMasterRequest.handle.bind(this._redeemMasterRequest));
        server.on('redeem_daemon_request', this._redeemDaemonRequest.handle.bind(this._redeemDaemonRequest));
        server.on('redeem_path_request', this._redeemPathRequest.handle.bind(this._redeemPathRequest));

        return Promise.resolve();
    }
}

module.exports = Daemon;
