/**
 * Daemon server
 * @module servers/daemon
 */
const debug = require('debug')('bhid:daemon');
const path = require('path');
const fs = require('fs');
const net = require('net');
const uuid = require('uuid');
const protobuf = require('protobufjs');
const EventEmitter = require('events');
const WError = require('verror').WError;
const SocketWrapper = require('socket-wrapper');

/**
 * Server class
 */
class Daemon extends EventEmitter {
    /**
     * Create the service
     * @param {App} app                     Application
     * @param {object} config               Configuration
     * @param {Logger} logger               Logger service
     */
    constructor(app, config, logger) {
        super();

        this.server = null;
        this.clients = new Map();

        this._name = null;
        this._app = app;
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'servers.daemon'
     * @type {string}
     */
    static get provides() {
        return 'servers.daemon';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger' ];
    }

    /**
     * How much time to wait for tracker response
     * @type {number}
     */
    static get requestTimeout() {
        return 60 * 1000; // ms
    }

    /**
     * Initialize the server
     * @param {string} name                     Config section name
     * @return {Promise}
     */
    init(name) {
        this._name = name;

        return new Promise((resolve, reject) => {
                debug('Loading protocol');
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(new WError(error, 'Daemon.init()'));

                    try {
                        this.proto = root;
                        this.InitRequest = this.proto.lookup('local.InitRequest');
                        this.InitResponse = this.proto.lookup('local.InitResponse');
                        this.ConfirmRequest = this.proto.lookup('local.ConfirmRequest');
                        this.ConfirmResponse = this.proto.lookup('local.ConfirmResponse');
                        this.CreateDaemonRequest = this.proto.lookup('local.CreateDaemonRequest');
                        this.CreateDaemonResponse = this.proto.lookup('local.CreateDaemonResponse');
                        this.SetTokenRequest = this.proto.lookup('local.SetTokenRequest');
                        this.SetTokenResponse = this.proto.lookup('local.SetTokenResponse');
                        this.CreateRequest = this.proto.lookup('local.CreateRequest');
                        this.CreateResponse = this.proto.lookup('local.CreateResponse');
                        this.DeleteRequest = this.proto.lookup('local.DeleteRequest');
                        this.DeleteResponse = this.proto.lookup('local.DeleteResponse');
                        this.ImportRequest = this.proto.lookup('local.ImportRequest');
                        this.ImportResponse = this.proto.lookup('local.ImportResponse');
                        this.AttachRequest = this.proto.lookup('local.AttachRequest');
                        this.AttachResponse = this.proto.lookup('local.AttachResponse');
                        this.DetachRequest = this.proto.lookup('local.DetachRequest');
                        this.DetachResponse = this.proto.lookup('local.DetachResponse');
                        this.Tree = this.proto.lookup('local.Tree');
                        this.TreeRequest = this.proto.lookup('local.TreeRequest');
                        this.TreeResponse = this.proto.lookup('local.TreeResponse');
                        this.ServerConnection = this.proto.lookup('local.ServerConnection');
                        this.ClientConnection = this.proto.lookup('local.ClientConnection');
                        this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                        this.ConnectionsListRequest = this.proto.lookup('local.ConnectionsListRequest');
                        this.ConnectionsListResponse = this.proto.lookup('local.ConnectionsListResponse');
                        this.SetConnectionsRequest = this.proto.lookup('local.SetConnectionsRequest');
                        this.SetConnectionsResponse = this.proto.lookup('local.SetConnectionsResponse');
                        this.ImportConnectionsRequest = this.proto.lookup('local.ImportConnectionsRequest');
                        this.ImportConnectionsResponse = this.proto.lookup('local.ImportConnectionsResponse');
                        this.UpdateConnectionsRequest = this.proto.lookup('local.UpdateConnectionsRequest');
                        this.UpdateConnectionsResponse = this.proto.lookup('local.UpdateConnectionsResponse');
                        this.RedeemMasterRequest = this.proto.lookup('local.RedeemMasterRequest');
                        this.RedeemMasterResponse = this.proto.lookup('local.RedeemMasterResponse');
                        this.RedeemDaemonRequest = this.proto.lookup('local.RedeemDaemonRequest');
                        this.RedeemDaemonResponse = this.proto.lookup('local.RedeemDaemonResponse');
                        this.RedeemPathRequest = this.proto.lookup('local.RedeemPathRequest');
                        this.RedeemPathResponse = this.proto.lookup('local.RedeemPathResponse');
                        this.ClientMessage = this.proto.lookup('local.ClientMessage');
                        this.ServerMessage = this.proto.lookup('local.ServerMessage');
                        resolve();
                    } catch (error) {
                        reject(new WError(error, 'Daemon.init()'));
                    }
                })
            })
            .then(() => {
                this.server = net.createServer(this.onConnection.bind(this));
                this.server.on('error', this.onServerError.bind(this));
                this.server.on('listening', this.onListening.bind(this));
            });
    }

    /**
     * Start the server
     * @param {string} name                     Config section name
     * @return {Promise}
     */
    start(name) {
        if (name !== this._name)
            return Promise.reject(new Error(`Server ${name} was not properly initialized`));

        return Array.from(this._app.get('modules')).reduce(
                (prev, [ curName, curModule ]) => {
                    return prev.then(() => {
                        if (!curModule.register)
                            return;

                        let result = curModule.register(name);
                        if (result === null || typeof result != 'object' || typeof result.then != 'function')
                            throw new Error(`Module '${curName}' register() did not return a Promise`);
                        return result;
                    });
                },
                Promise.resolve()
            )
            .then(() => {
                debug('Starting the server');
                try {
                    let sock = path.join('/var', 'run', this._config.project, this._config.instance + '.sock');
                    try {
                        fs.accessSync(sock, fs.constants.F_OK);
                        fs.unlinkSync(sock);
                    } catch (error) {
                        // do nothing
                    }
                    this.server.listen(sock);
                } catch (error) {
                    throw new WError(error, 'Daemon.start()');
                }
            });
    }

    /**
     * Send message
     * @param {string} id                   Client ID
     * @param {Buffer|null} data            Data to send
     */
    send(id, data) {
        let client = this.clients.get(id);
        if (!client || !client.socket || !client.wrapper)
            return;

        client.wrapper.send(data);
    }

    /**
     * Server error handler
     * @param {object} error            The error
     */
    onServerError(error) {
        if (error.syscall !== 'listen')
            return this._logger.error(new WError(error, 'Daemon.onServerError()'));

        switch (error.code) {
            case 'EACCES':
                this._logger.error('Daemon socket requires elevated privileges');
                break;
            case 'EADDRINUSE':
                this._logger.error('Daemon socket is already in use');
                break;
            default:
                this._logger.error(error);
        }
        process.exit(1);
    }

    /**
     * Server listening event handler
     */
    onListening() {
        this._logger.info(`Daemon server listening on /var/run/${this._config.project}/${this._config.instance}.sock`);
    }

    /**
     * Connection handler
     * @param {object} socket           Client socket
     */
    onConnection(socket) {
        let id = uuid.v1();
        debug(`New socket`);

        let client = {
            id: id,
            socket: socket,
            wrapper: new SocketWrapper(socket),
        };
        this.clients.set(id, client);

        client.wrapper.on(
            'receive',
            data => {
                if (!this.onMessage(id, data)) {
                    socket.end();
                    client.wrapper.detach();
                }
            }
        );

        socket.on('error', error => { this.onError(id, error); });
        socket.on('close', () => { this.onClose(id); });

        this.emit('connection', id);
    }

    /**
     * Client message handler
     * @param {string} id               Client ID
     * @param {Buffer} data             Message
     * @return {boolean}                Destroy socket on false
     */
    onMessage(id, data) {
        let client = this.clients.get(id);
        if (!client)
            return false;

        if (!data || !data.length)
            return true;

        let message;
        try {
            message = this.ClientMessage.decode(data);
        } catch (error) {
            this._logger.error(`Daemon protocol error: ${error.message}`);
            return false;
        }

        try {
            debug(`Client message ${message.type}`);
            switch(message.type) {
                case this.ClientMessage.Type.INIT_REQUEST:
                    this.emit('init_request', id, message);
                    break;
                case this.ClientMessage.Type.CONFIRM_REQUEST:
                    this.emit('confirm_request', id, message);
                    break;
                case this.ClientMessage.Type.CREATE_DAEMON_REQUEST:
                    this.emit('create_daemon_request', id, message);
                    break;
                case this.ClientMessage.Type.SET_TOKEN_REQUEST:
                    this.emit('set_token_request', id, message);
                    break;
                case this.ClientMessage.Type.CREATE_REQUEST:
                    this.emit('create_request', id, message);
                    break;
                case this.ClientMessage.Type.DELETE_REQUEST:
                    this.emit('delete_request', id, message);
                    break;
                case this.ClientMessage.Type.IMPORT_REQUEST:
                    this.emit('import_request', id, message);
                    break;
                case this.ClientMessage.Type.ATTACH_REQUEST:
                    this.emit('attach_request', id, message);
                    break;
                case this.ClientMessage.Type.DETACH_REQUEST:
                    this.emit('detach_request', id, message);
                    break;
                case this.ClientMessage.Type.TREE_REQUEST:
                    this.emit('tree_request', id, message);
                    break;
                case this.ClientMessage.Type.CONNECTIONS_LIST_REQUEST:
                    this.emit('connections_list_request', id, message);
                    break;
                case this.ClientMessage.Type.SET_CONNECTIONS_REQUEST:
                    this.emit('set_connections_request', id, message);
                    break;
                case this.ClientMessage.Type.IMPORT_CONNECTIONS_REQUEST:
                    this.emit('import_connections_request', id, message);
                    break;
                case this.ClientMessage.Type.UPDATE_CONNECTIONS_REQUEST:
                    this.emit('update_connections_request', id, message);
                    break;
                case this.ClientMessage.Type.REDEEM_MASTER_REQUEST:
                    this.emit('redeem_master_request', id, message);
                    break;
                case this.ClientMessage.Type.REDEEM_DAEMON_REQUEST:
                    this.emit('redeem_daemon_request', id, message);
                    break;
                case this.ClientMessage.Type.REDEEM_PATH_REQUEST:
                    this.emit('redeem_path_request', id, message);
                    break;
            }
        } catch (error) {
            this._logger.error(new WError(error, 'Daemon.onMessage()'));
        }

        return true;
    }

    /**
     * Client error handler
     * @param {string} id                   Client ID
     * @param {Error} error                 Error
     */
    onError(id, error) {
        this._logger.error(`Daemon socket error: ${error.message}`);
    }

    /**
     * Client disconnect handler
     * @param {string} id                   Client ID
     */
    onClose(id) {
        let client = this.clients.get(id);
        if (client) {
            debug(`Client disconnected`);
            if (client.socket) {
                if (!client.socket.destroyed)
                    client.socket.destroy();
                client.socket = null;
                client.wrapper.destroy();
                client.wrapper = null;
            }
            this.clients.delete(id);
        }
    }
}

module.exports = Daemon;