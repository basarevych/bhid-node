/**
 * Tracker server
 * @module servers/tracker
 */
const debug = require('debug')('bhid:tracker');
const path = require('path');
const fs = require('fs');
const ini = require('ini');
const tls = require('tls');
const uuid = require('uuid');
const os = require('os');
const protobuf = require('protobufjs');
const EventEmitter = require('events');
const WError = require('verror').WError;
const SocketWrapper = require('socket-wrapper');

/**
 * Server class
 */
class Tracker extends EventEmitter {
    /**
     * Create the service
     * @param {App} app                             Application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {Runner} runner                       Runner service
     * @param {Crypter} crypter                     Crypter service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, runner, crypter, connectionsList) {
        super();

        this.servers = new Map();
        this.default = null;

        this._name = null;
        this._app = app;
        this._config = config;
        this._connectionsList = connectionsList;
        this._logger = logger;
        this._runner = runner;
        this._crypter = crypter;
        this._timeouts = new Map();
    }

    /**
     * Service name is 'servers.tracker'
     * @type {string}
     */
    static get provides() {
        return 'servers.tracker';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'runner', 'modules.peer.crypter', 'modules.peer.connectionsList' ];
    }

    /**
     * Will send keep alive at this interval
     * @type {number}
     */
    static get pingTimeout() {
        return 2 * 1000; // ms
    }

    /**
     * No data in socket timeout
     * @type {number}
     */
    static get pongTimeout() {
        return 5 * 1000; // ms
    }

    /**
     * Pause when reconnecting to tracker
     * @type {number}
     */
    static get reconnectPause() {
        return 1000; // ms
    }

    /**
     * Tracker section delimiter in config
     */
    static get trackerSection() {
        return ':tracker';
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
                protobuf.load(path.join(this._config.base_path, 'proto', 'tracker.proto'), (error, root) => {
                    if (error)
                        return reject(new WError(error, 'Tracker.init()'));

                    try {
                        this.proto = root;
                        this.InitRequest = this.proto.lookup('tracker.InitRequest');
                        this.InitResponse = this.proto.lookup('tracker.InitResponse');
                        this.ConfirmRequest = this.proto.lookup('tracker.ConfirmRequest');
                        this.ConfirmResponse = this.proto.lookup('tracker.ConfirmResponse');
                        this.CreateDaemonRequest = this.proto.lookup('tracker.CreateDaemonRequest');
                        this.CreateDaemonResponse = this.proto.lookup('tracker.CreateDaemonResponse');
                        this.RegisterDaemonRequest = this.proto.lookup('tracker.RegisterDaemonRequest');
                        this.RegisterDaemonResponse = this.proto.lookup('tracker.RegisterDaemonResponse');
                        this.CreateRequest = this.proto.lookup('tracker.CreateRequest');
                        this.CreateResponse = this.proto.lookup('tracker.CreateResponse');
                        this.DeleteRequest = this.proto.lookup('tracker.DeleteRequest');
                        this.DeleteResponse = this.proto.lookup('tracker.DeleteResponse');
                        this.ImportRequest = this.proto.lookup('tracker.ImportRequest');
                        this.ImportResponse = this.proto.lookup('tracker.ImportResponse');
                        this.AttachRequest = this.proto.lookup('tracker.AttachRequest');
                        this.AttachResponse = this.proto.lookup('tracker.AttachResponse');
                        this.DetachRequest = this.proto.lookup('tracker.DetachRequest');
                        this.DetachResponse = this.proto.lookup('tracker.DetachResponse');
                        this.Tree = this.proto.lookup('tracker.Tree');
                        this.TreeRequest = this.proto.lookup('tracker.TreeRequest');
                        this.TreeResponse = this.proto.lookup('tracker.TreeResponse');
                        this.ServerConnection = this.proto.lookup('tracker.ServerConnection');
                        this.ClientConnection = this.proto.lookup('tracker.ClientConnection');
                        this.ConnectionsList = this.proto.lookup('tracker.ConnectionsList');
                        this.ConnectionsListRequest = this.proto.lookup('tracker.ConnectionsListRequest');
                        this.ConnectionsListResponse = this.proto.lookup('tracker.ConnectionsListResponse');
                        this.InternalAddress = this.proto.lookup('tracker.InternalAddress');
                        this.Status = this.proto.lookup('tracker.Status');
                        this.ServerAvailable = this.proto.lookup('tracker.ServerAvailable');
                        this.LookupIdentityRequest = this.proto.lookup('tracker.LookupIdentityRequest');
                        this.LookupIdentityResponse = this.proto.lookup('tracker.LookupIdentityResponse');
                        this.PunchRequest = this.proto.lookup('tracker.PunchRequest');
                        this.AddressRequest = this.proto.lookup('tracker.AddressRequest');
                        this.AddressResponse = this.proto.lookup('tracker.AddressResponse');
                        this.PeerAvailable = this.proto.lookup('tracker.PeerAvailable');
                        this.RedeemMasterRequest = this.proto.lookup('tracker.RedeemMasterRequest');
                        this.RedeemMasterResponse = this.proto.lookup('tracker.RedeemMasterResponse');
                        this.RedeemDaemonRequest = this.proto.lookup('tracker.RedeemDaemonRequest');
                        this.RedeemDaemonResponse = this.proto.lookup('tracker.RedeemDaemonResponse');
                        this.RedeemPathRequest = this.proto.lookup('tracker.RedeemPathRequest');
                        this.RedeemPathResponse = this.proto.lookup('tracker.RedeemPathResponse');
                        this.ClientMessage = this.proto.lookup('tracker.ClientMessage');
                        this.ServerMessage = this.proto.lookup('tracker.ServerMessage');
                        resolve();
                    } catch (error) {
                        reject(new WError(error, 'Tracker.init()'));
                    }
                })
            })
            .then(() => {
                let configPath;
                for (let candidate of [ '/etc/bhid', '/usr/local/etc/bhid' ]) {
                    try {
                        fs.accessSync(path.join(candidate, 'bhid.conf'), fs.constants.F_OK);
                        configPath = candidate;
                        break;
                    } catch (error) {
                        // do nothing
                    }
                }

                if (!configPath)
                    throw new Error('Could not read bhid.conf');

                let bhidConfig = ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));
                for (let section of Object.keys(bhidConfig)) {
                    if (!section.endsWith(this.constructor.trackerSection))
                        continue;

                    let tracker = section.substr(0, section.length - this.constructor.trackerSection.length);
                    let ca = bhidConfig[section]['ca_file'];
                    if (ca && ca[0] != '/')
                        ca = path.join(configPath, 'certs', ca);
                    if (ca)
                        ca = fs.readFileSync(ca);

                    let server = {
                        name: tracker,
                        socket: null,
                        wrapper: new SocketWrapper(),
                        address: tracker,
                        port: bhidConfig[section]['port'] || '42042',
                        options: { ca: ca },
                        token: bhidConfig[section]['token'] || null,
                        connected: false,
                        registered: false,
                    };

                    this.servers.set(tracker, server);
                    if (bhidConfig[section]['default'] == 'yes')
                        this.default = tracker;
                }
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
                for (let server of this.servers.keys())
                    this._reconnect(server);
                this._timeoutTimer = setInterval(() => { this._checkTimeout(); }, 500);
            });
    }

    /**
     * Get server
     * @param {string} name                 Tracker name
     * @return {string}
     */
    getServer(name) {
        if (!name)
            name = this.default;
        if (!name)
            return null;

        return this.servers.get(name);
    }

    /**
     * Get daemon token for the tracker
     * @param {string} name                 Tracker name
     * @return {string}
     */
    getToken(name) {
        if (!name)
            name = this.default;
        if (!name)
            return '';

        let server = this.servers.get(name);
        if (!server || !server.token || !server.registered)
            return '';

        return server.token;
    }

    /**
     * Set daemon token for the tracker
     * @param {string} name         Name of the tracker
     * @param {string} token        The token
     * @return {Promise}            Resolves to success
     */
    setToken(name, token) {
        if (!name)
            name = this.default;
        let server = this.servers.get(name);
        if (!server)
            return Promise.resolve(false);

        let configPath, newIdentity = false;
        return Promise.resolve()
            .then(() => {
                for (let candidate of ['/etc/bhid', '/usr/local/etc/bhid']) {
                    try {
                        fs.accessSync(path.join(candidate, 'bhid.conf'), fs.constants.F_OK);
                        configPath = candidate;
                        break;
                    } catch (error) {
                        // do nothing
                    }
                }

                if (!configPath)
                    throw new Error('Could not read bhid.conf');

                debug('Creating RSA keys');
                return this._runner.exec(
                        'openssl',
                        [
                            'genrsa',
                            '-out', path.join(configPath, 'id', 'private.rsa'),
                            '2048'
                        ]
                    )
                    .then(result => {
                        if (result.code !== 0)
                            throw new Error('Could not create private key');

                        return this._runner.exec(
                                'openssl',
                                [
                                    'rsa',
                                    '-in', path.join(configPath, 'id', 'private.rsa'),
                                    '-outform', 'PEM',
                                    '-pubout',
                                    '-out', path.join(configPath, 'id', 'public.rsa')
                                ]
                            )
                            .then(result => {
                                if (result.code !== 0)
                                    return result;

                                return this._runner.exec('chmod', ['600', path.join(configPath, 'id', 'private.rsa')])
                                    .then(() => {
                                        return result;
                                    });
                            });
                    })
                    .then(result => {
                        if (result.code !== 0)
                            throw new Error('Could not create public key');

                        this._peer.publicKey = fs.readFileSync(path.join(configPath, 'id', 'public.rsa'), 'utf8');
                        this._peer.privateKey = fs.readFileSync(path.join(configPath, 'id', 'private.rsa'), 'utf8');
                        this._crypter.init(this._peer.publicKey, this._peer.privateKey);

                        newIdentity = true;
                    });
            })
            .then(() => {
                this._connectionsList.set(
                    name,
                    {
                        serverConnections: [],
                        clientConnections: [],
                    }
                );
                if (!this._connectionsList.save())
                    throw new Error('Could not clear connections');

                let bhidConfig = ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));
                for (let section of Object.keys(bhidConfig)) {
                    if (!section.endsWith(this.constructor.trackerSection))
                        continue;

                    let tracker = section.substr(0, section.length - this.constructor.trackerSection.length);
                    if (tracker == name) {
                        bhidConfig[section]['token'] = token;
                        debug(`Tracker ${name} token updated`);
                        break;
                    }
                }

                fs.writeFileSync(path.join(configPath, 'bhid.conf'), ini.stringify(bhidConfig));
                server.token = token;

                server.socket.end();
                server.wrapper.detach();
                this.emit('token', name);

                return true;
            })
            .catch(error => {
                this._logger.error(new WError(error, 'Tracker.setToken()'));
                if (newIdentity) {
                    server.socket.end();
                    server.wrapper.detach();
                }
                return false;
            });
    }

    /**
     * Send message
     * @param {string} name                 Tracker name
     * @param {Buffer|null} data            Data to send
     */
    send(name, data) {
        if (!name)
            name = this.default;
        let server = this.servers.get(name);
        if (!server || !server.socket || !server.wrapper)
            return;

        if (!data) {
            try {
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.ALIVE,
                });
                data = this.ClientMessage.encode(message).finish();
            } catch (error) {
                this._logger.error(new WError(error, `Tracker.send()`));
                return;
            }
        }

        server.wrapper.send(data);
    }

    /**
     * Send status message
     * @param {string} trackerName          Tracker name
     * @param {string} connectionName       Connection name
     * @param {boolean} [active=true]       Is active
     */
    sendStatus(trackerName, connectionName, active = true) {
        let server = this.servers.get(trackerName);
        if (!server || !server.registered)
            return;

        let connection = this._peer.connections.get(trackerName + '#' + connectionName);
        if (!connection)
            return;

        let connected = 0;
        let trackedConnections = this._connectionsList.get(trackerName);
        if (trackedConnections) {
            let serverInfo = trackedConnections.serverConnections.get(connectionName);
            let clientInfo = trackedConnections.clientConnections.get(connectionName);
            if (serverInfo)
                connected = serverInfo.connected;
            else if (clientInfo)
                connected = clientInfo.connected;
        }

        try {
            debug(`Sending STATUS of ${connectionName} to ${trackerName}`);
            let addresses = [];
            if (connection.server && connection.utp) {
                let utpAddress = connection.utp.address();
                let interfaces = os.networkInterfaces();
                for (let iface of Object.keys(interfaces)) {
                    for (let alias of interfaces[iface]) {
                        if (alias.internal || [ 'IPv4', 'IPv6' ].indexOf(alias.family) == -1)
                            continue;

                        addresses.push(this.InternalAddress.create({
                            family: alias.family,
                            address: alias.address,
                            port: utpAddress.port.toString(),
                        }));
                    }
                }
            }
            let status = this.Status.create({
                connectionName: connectionName,
                connected: connected,
                active: active,
                internalAddresses: addresses,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.STATUS,
                status: status,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            this.send(trackerName, buffer);
        } catch (error) {
            this._logger.error(new WError(error, `Tracker.sendStatus()`));
        }
    }

    /**
     * Send lookup identity request message
     * @param {string} trackerName          Tracker name
     * @param {string} identity             Identity
     */
    sendLookupIdentityRequest(trackerName, identity) {
        let server = this.servers.get(trackerName);
        if (!server || !server.registered)
            return null;

        try {
            debug(`Sending LOOKUP IDENTITY to ${trackerName}`);
            let id = uuid.v1();
            let request = this.LookupIdentityRequest.create({
                identity: identity,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.LOOKUP_IDENTITY_REQUEST,
                messageId: id,
                lookupIdentityRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            this.send(trackerName, buffer);
            return id;
        } catch (error) {
            this._logger.error(new WError(error, `Tracker.sendLookupIdentityRequest()`));
        }

        return null;
    }

    /**
     * Send punch request message
     * @param {string} trackerName          Tracker name
     * @param {string} connectionName       Connection name
     */
    sendPunchRequest(trackerName, connectionName) {
        let server = this.servers.get(trackerName);
        if (!server || !server.registered)
            return;

        try {
            debug(`Sending PUNCH REQUEST of ${connectionName} to ${trackerName}`);
            let request = this.PunchRequest.create({
                connectionName: connectionName,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.PUNCH_REQUEST,
                punchRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            this.send(trackerName, buffer);
        } catch (error) {
            this._logger.error(new WError(error, `Tracker.sendPunchRequest()`));
        }
    }

    /**
     * Tracker message handler
     * @param {string} name             Tracker name
     * @param {Buffer} data             Message
     * @return {boolean}                Destroy socket on false
     */
    onMessage(name, data) {
        let server = this.servers.get(name);
        if (!server)
            return false;

        if (!data || !data.length)
            return true;

        let message;
        try {
            message = this.ServerMessage.decode(data);
            if (message.type === this.ServerMessage.Type.ALIVE)
                return true;
        } catch (error) {
            this._logger.error(`Tracker protocol error: ${error.message}`);
            return false;
        }

        try {
            debug(`Tracker message ${message.type} from ${name}`);
            switch(message.type) {
                case this.ServerMessage.Type.INIT_RESPONSE:
                    this.emit('init_response', name, message);
                    break;
                case this.ServerMessage.Type.CONFIRM_RESPONSE:
                    this.emit('confirm_response', name, message);
                    break;
                case this.ServerMessage.Type.CREATE_DAEMON_RESPONSE:
                    this.emit('create_daemon_response', name, message);
                    break;
                case this.ServerMessage.Type.REGISTER_DAEMON_RESPONSE:
                    this.emit('register_daemon_response', name, message);
                    break;
                case this.ServerMessage.Type.CREATE_RESPONSE:
                    this.emit('create_response', name, message);
                    break;
                case this.ServerMessage.Type.DELETE_RESPONSE:
                    this.emit('delete_response', name, message);
                    break;
                case this.ServerMessage.Type.IMPORT_RESPONSE:
                    this.emit('import_response', id, message);
                    break;
                case this.ServerMessage.Type.ATTACH_RESPONSE:
                    this.emit('attach_response', id, message);
                    break;
                case this.ServerMessage.Type.DETACH_RESPONSE:
                    this.emit('detach_response', id, message);
                    break;
                case this.ServerMessage.Type.TREE_RESPONSE:
                    this.emit('tree_response', name, message);
                    break;
                case this.ServerMessage.Type.CONNECTIONS_LIST_RESPONSE:
                    this.emit('connections_list_response', name, message);
                    break;
                case this.ServerMessage.Type.CONNECTIONS_LIST:
                    this.emit('connections_list', name, message);
                    break;
                case this.ServerMessage.Type.SERVER_AVAILABLE:
                    this.emit('server_available', name, message);
                    break;
                case this.ServerMessage.Type.LOOKUP_IDENTITY_RESPONSE:
                    this.emit('lookup_identity_response', name, message);
                    break;
                case this.ServerMessage.Type.ADDRESS_REQUEST:
                    this.emit('address_request', name, message);
                    break;
                case this.ServerMessage.Type.PEER_AVAILABLE:
                    this.emit('peer_available', name, message);
                    break;
                case this.ServerMessage.Type.REDEEM_MASTER_RESPONSE:
                    this.emit('redeem_master_response', name, message);
                    break;
                case this.ServerMessage.Type.REDEEM_DAEMON_RESPONSE:
                    this.emit('redeem_daemon_response', name, message);
                    break;
                case this.ServerMessage.Type.REDEEM_PATH_RESPONSE:
                    this.emit('redeem_path_response', name, message);
                    break;
            }
        } catch (error) {
            this._logger.error(new WError(error, 'Tracker.onMessage()'));
        }

        return true;
    }

    /**
     * Tracker error handler
     * @param {string} name                 Tracker name
     * @param {Error} error                 Error
     */
    onError(name, error) {
        if (error.code !== 'ECONNRESET')
            this._logger.error(`Tracker socket error: ${error.message}`);
    }

    /**
     * Tracker disconnect handler
     * @param {string} name                 Tracker name
     */
    onClose(name) {
        let server = this.servers.get(name);
        if (!server || !server.socket)
            return;

        if (server.registered)
            this._logger.info(`Tracker ${name} disconnected`);

        if (!server.socket.destroyed)
            server.socket.destroy();
        server.socket = null;
        server.wrapper.detach();
        server.connected = false;
        server.registered = false;

        this._timeouts.delete(name);
        setTimeout(() => { this._reconnect(name); }, this.constructor.reconnectPause);
    }

    /**
     * Client timeout handler
     * @param {string} name                 Tracker name
     */
    onTimeout(name) {
        debug(`Tracker ${name} timeout`);
        let server = this.servers.get(name);
        if (server && server.socket) {
            server.socket.destroy();
            server.wrapper.detach();
        }
    }

    /**
     * Reconnect to the tracker
     * @param {string} name                 Name of the server
     */
    _reconnect(name) {
        let server = this.servers.get(name);

        try {
            debug(`Initiating connection to ${name}`);
            server.socket = tls.connect(
                server.port,
                server.address,
                server.options,
                () => {
                    this._logger.info(`Connected to tracker ${name}`);
                    server.connected = true;

                    server.wrapper.clear();
                    server.wrapper.attach(server.socket);
                    server.wrapper.removeAllListeners();
                    server.wrapper.on(
                        'receive',
                        data => {
                            if (!this.onMessage(name, data)) {
                                server.socket.end();
                                server.wrapper.detach();
                            }
                        }
                    );
                    server.wrapper.on(
                        'read',
                        data => {
                            let timeout = this._timeouts.get(name);
                            if (timeout)
                                timeout.receive = Date.now() + this.constructor.pongTimeout;
                        }
                    );
                    server.wrapper.on(
                        'flush',
                        data => {
                            let timeout = this._timeouts.get(name);
                            if (timeout)
                                timeout.send = Date.now() + this.constructor.pingTimeout;
                        }
                    );

                    this._timeouts.set(
                        name,
                        {
                            send: Date.now() + this.constructor.pingTimeout,
                            receive: Date.now() + this.constructor.pongTimeout,
                        }
                    );

                    this.emit('connection', name);
                }
            );

            server.socket.on('error', error => { this.onError(name, error); });
            server.socket.on('close', () => { this.onClose(name); });

            this._timeouts.set(
                name,
                {
                    send: 0,
                    receive: Date.now() + this.constructor.connectTimeout,
                }
            );
        } catch (error) {
            this._logger.error(new WError(error, `Tracker._reconnect(): ${name}`));
        }
    }

    /**
     * Check socket timeout
     */
    _checkTimeout() {
        let now = Date.now();
        for (let [ name, timestamp ] of this._timeouts) {
            if (!name)
                continue;
            if (!this.servers.has(name)) {
                this._timeouts.delete(name);
                continue;
            }

            if (timestamp.receive !== 0 && now >= timestamp.receive) {
                timestamp.receive = 0;
                timestamp.send = 0;
                this.onTimeout(name);
            } else if (timestamp.send !== 0 && now >= timestamp.send) {
                timestamp.send = 0;
                this.send(name, null);
            }
        }
    }

    /**
     * Retrieve peer server
     * @return {Peer}
     */
    get _peer() {
        if (this._peer_instance)
            return this._peer_instance;
        this._peer_instance = this._app.get('servers').get('peer');
        return this._peer_instance;
    }
}

module.exports = Tracker;