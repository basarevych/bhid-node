/**
 * Daemon server
 * @module servers/daemon
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const uuid = require('uuid');
const protobuf = require('protobufjs');
const EventEmitter = require('events');
const NError = require('nerror');
const SocketWrapper = require('socket-wrapper');

/**
 * Server for unix socket clients, i.e. command line interface
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

        this.server = null;                                 // tcp on unix socket
        this.clients = new Map();                           // uuid => DaemonClient(uuid)

        this._name = null;
        this._listening = false;
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
                this._logger.debug('daemon', 'Loading protocol');
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(new NError(error, 'Daemon.init()'));

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
                        this.GetConnectionsRequest = this.proto.lookup('local.GetConnectionsRequest');
                        this.GetConnectionsResponse = this.proto.lookup('local.GetConnectionsResponse');
                        this.ImportConnectionsRequest = this.proto.lookup('local.ImportConnectionsRequest');
                        this.ImportConnectionsResponse = this.proto.lookup('local.ImportConnectionsResponse');
                        this.UpdateConnectionsRequest = this.proto.lookup('local.UpdateConnectionsRequest');
                        this.UpdateConnectionsResponse = this.proto.lookup('local.UpdateConnectionsResponse');
                        this.Daemon = this.proto.lookup('local.Daemon');
                        this.DaemonsListRequest = this.proto.lookup('local.DaemonsListRequest');
                        this.DaemonsListResponse = this.proto.lookup('local.DaemonsListResponse');
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
                        reject(new NError(error, 'Daemon.init()'));
                    }
                });
            })
            .then(() => {
                this.server = net.createServer(this.onConnection.bind(this));
                this.server.on('error', this.onServerError.bind(this));
                this.server.on('listening', this.onListening.bind(this));
            })
            .catch(error => {
                return new Promise(() => {
                    this._logger.error(error.messages || error.message, () => { process.exit(255); });
                });
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
                        if (result === null || typeof result !== 'object' || typeof result.then !== 'function')
                            throw new Error(`Module '${curName}' register() did not return a Promise`);
                        return result;
                    });
                },
                Promise.resolve()
            )
            .then(() => {
                this._logger.debug('daemon', 'Starting the server');
                return new Promise((resolve, reject) => {
                    let sockDir = path.join('/var', 'run', this._config.project);
                    let sockFile = path.join(sockDir, this._config.instance + '.sock');
                    try {
                        fs.accessSync(sockDir, fs.constants.R_OK | fs.constants.W_OK);
                    } catch (error) {
                        return reject(new Error(`No access to ${sockDir}`));
                    }
                    try {
                        fs.accessSync(sockFile, fs.constants.F_OK);
                        fs.unlinkSync(sockFile);
                    } catch (error) {
                        // do nothing
                    }
                    try {
                        this.server.once('listening', resolve);
                        this.server.listen(sockFile);
                    } catch (error) {
                        reject(error);
                    }
                });
            })
            .catch(error => {
                return new Promise(() => {
                    this._logger.error(error.messages || error.message, () => { process.exit(255); });
                });
            });
    }

    /**
     * Stop the server
     * @param {string} name                     Config section name
     * @return {Promise}
     */
    stop(name) {
        if (name !== this._name)
            return Promise.reject(new Error(`Server ${name} was not properly initialized`));

        this.server.close();
        this.server = null;

        return new Promise((resolve, reject) => {
            try {
                let sock = `/var/run/${this._config.project}/${this._config.instance}.sock`;
                this._logger.info(`Daemon is no longer listening on ${sock}`, () => { resolve(); });
            } catch (error) {
                reject(error);
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
        if (!client)
            return;

        client.wrapper.send(data);
    }

    /**
     * Server error handler
     * @param {object} error            The error
     */
    onServerError(error) {
        if (error.syscall !== 'listen')
            return this._logger.error(new NError(error, 'Daemon.onServerError()'));

        let msg;
        switch (error.code) {
            case 'EACCES':
                msg = 'Could not bind to daemon socket';
                break;
            case 'EADDRINUSE':
                msg = 'Daemon socket is already in use';
                break;
            default:
                msg = error;
        }
        this._logger.error(msg, () => { process.exit(255); });
    }

    /**
     * Server listening event handler
     */
    onListening() {
        let sock = `/var/run/${this._config.project}/${this._config.instance}.sock`;
        try {
            fs.chmodSync(sock, 0o600);
        } catch (error) {
            this._logger.error('Could not prepare daemon socket', () => { process.exit(255); });
        }

        this._listening = true;
        this._logger.info(`Daemon is listening on ${sock}`);
    }

    /**
     * Connection handler
     * @param {object} socket           Client socket
     */
    onConnection(socket) {
        if (!this._listening) {
            socket.end();
            return;
        }

        let id = uuid.v1();
        this._logger.debug('daemon', `New socket ${id}`);

        let client = this._app.get('entities.daemonClient', id);
        client.socket = socket;
        client.wrapper = new SocketWrapper(socket);
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
        socket.on('end', () => { client.wrapper.detach(); });

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

        let message;
        try {
            message = this.ClientMessage.decode(data);
        } catch (error) {
            this._logger.error(`Daemon protocol error: ${error.message}`);
            return false;
        }

        try {
            this._logger.debug('daemon', `Incoming message ${message.type}`);
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
                case this.ClientMessage.Type.DAEMONS_LIST_REQUEST:
                    this.emit('daemons_list_request', id, message);
                    break;
                case this.ClientMessage.Type.SET_CONNECTIONS_REQUEST:
                    this.emit('set_connections_request', id, message);
                    break;
                case this.ClientMessage.Type.GET_CONNECTIONS_REQUEST:
                    this.emit('get_connections_request', id, message);
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
            this._logger.error(new NError(error, 'Daemon.onMessage()'));
        }

        return true;
    }

    /**
     * Client error handler
     * @param {string} id                   Client ID
     * @param {Error} error                 Error
     */
    onError(id, error) {
        this._logger.error(`Daemon socket error: ${error.fullStack || error.stack}`);
    }

    /**
     * Client disconnect handler
     * @param {string} id                   Client ID
     */
    onClose(id) {
        let client = this.clients.get(id);
        if (client) {
            this._logger.debug('daemon', `Client disconnected ${id}`);
            client.socket.destroy();
            client.wrapper.destroy();
            this.clients.delete(id);
        }
    }
}

module.exports = Daemon;