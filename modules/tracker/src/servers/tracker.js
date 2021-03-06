/**
 * Tracker server
 * @module servers/tracker
 */
const path = require('path');
const fs = require('fs');
const tls = require('tls');
const uuid = require('uuid');
const os = require('os');
const protobuf = require('protobufjs');
const EventEmitter = require('events');
const NError = require('nerror');
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
     * @param {Filer} filer                         Filer service
     * @param {Runner} runner                       Runner service
     * @param {Ini} ini                             Ini service
     * @param {Crypter} crypter                     Crypter service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, filer, runner, ini, crypter, connectionsList) {
        super();

        this.servers = new Map();                   // name => TrackerServer(name)
        this.default = null;                        // name

        this._name = null;
        this._closing = false;
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._filer = filer;
        this._runner = runner;
        this._ini = ini;
        this._crypter = crypter;
        this._connectionsList = connectionsList;
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
        return [ 'app', 'config', 'logger', 'filer', 'runner', 'ini', 'crypter', 'connectionsList' ];
    }

    /**
     * Connect timeout
     * @type {number}
     */
    static get connectTimeout() {
        return 5 * 1000; // ms
    }

    /**
     * Will send keep alive at this interval
     * @type {number}
     */
    static get pingTimeout() {
        return 7 * 1000; // ms
    }

    /**
     * No data in socket timeout
     * @type {number}
     */
    static get pongTimeout() {
        return 10 * 1000; // ms
    }

    /**
     * Pause when reconnecting to tracker
     * @type {number}
     */
    static get reconnectPause() {
        return 3 * 1000; // ms
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
    async init(name) {
        this._name = name;

        try {
            await new Promise((resolve, reject) => {
                this._logger.debug('tracker', 'Loading protocol');
                protobuf.load(path.join(this._config.base_path, 'proto', 'tracker.proto'), (error, root) => {
                    if (error)
                        return reject(new NError(error, 'Tracker.init()'));

                    this.proto = root;
                    this.InitRequest = this.proto.lookup('tracker.InitRequest');
                    this.InitResponse = this.proto.lookup('tracker.InitResponse');
                    this.ConfirmRequest = this.proto.lookup('tracker.ConfirmRequest');
                    this.ConfirmResponse = this.proto.lookup('tracker.ConfirmResponse');
                    this.CreateDaemonRequest = this.proto.lookup('tracker.CreateDaemonRequest');
                    this.CreateDaemonResponse = this.proto.lookup('tracker.CreateDaemonResponse');
                    this.DeleteDaemonRequest = this.proto.lookup('tracker.DeleteDaemonRequest');
                    this.DeleteDaemonResponse = this.proto.lookup('tracker.DeleteDaemonResponse');
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
                    this.RemoteAttachRequest = this.proto.lookup('tracker.RemoteAttachRequest');
                    this.RemoteAttachResponse = this.proto.lookup('tracker.RemoteAttachResponse');
                    this.DetachRequest = this.proto.lookup('tracker.DetachRequest');
                    this.DetachResponse = this.proto.lookup('tracker.DetachResponse');
                    this.RemoteDetachRequest = this.proto.lookup('tracker.RemoteDetachRequest');
                    this.RemoteDetachResponse = this.proto.lookup('tracker.RemoteDetachResponse');
                    this.Tree = this.proto.lookup('tracker.Tree');
                    this.TreeRequest = this.proto.lookup('tracker.TreeRequest');
                    this.TreeResponse = this.proto.lookup('tracker.TreeResponse');
                    this.ServerConnection = this.proto.lookup('tracker.ServerConnection');
                    this.ClientConnection = this.proto.lookup('tracker.ClientConnection');
                    this.ConnectionsList = this.proto.lookup('tracker.ConnectionsList');
                    this.ConnectionsListRequest = this.proto.lookup('tracker.ConnectionsListRequest');
                    this.ConnectionsListResponse = this.proto.lookup('tracker.ConnectionsListResponse');
                    this.Daemon = this.proto.lookup('tracker.Daemon');
                    this.DaemonsListRequest = this.proto.lookup('tracker.DaemonsListRequest');
                    this.DaemonsListResponse = this.proto.lookup('tracker.DaemonsListResponse');
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
                });
            });

            let configPath = (os.platform() === 'freebsd' ? '/usr/local/etc/bhid' : '/etc/bhid');
            try {
                fs.accessSync(path.join(configPath, 'bhid.conf'), fs.constants.F_OK);
            } catch (error) {
                throw new Error('Could not read bhid.conf');
            }

            let bhidConfig = this._ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));
            for (let section of Object.keys(bhidConfig)) {
                if (!section.endsWith(this.constructor.trackerSection))
                    continue;

                let tracker = section.substr(0, section.length - this.constructor.trackerSection.length);
                let ca = bhidConfig[section].ca_file;
                if (ca && ca[0] !== '/')
                    ca = path.join(configPath, 'certs', ca);
                if (ca)
                    ca = fs.readFileSync(ca);

                let server = this._app.get('entities.trackerServer', tracker);
                server.email = null;
                server.daemonName = null;
                server.socket = null;
                server.wrapper = new SocketWrapper();
                server.address = tracker;
                server.port = bhidConfig[section].port || '42042';
                server.options = {ca: ca};
                server.token = bhidConfig[section].token || null;
                server.connected = false;
                server.registered = false;
                this.servers.set(tracker, server);

                if (bhidConfig[section].default === 'yes')
                    this.default = tracker;
            }
        } catch (error) {
            return this._app.exit(
                this._app.constructor.fatalExitCode,
                error.messages || error.message
            );
        }
    }

    /**
     * Start the server
     * @param {string} name                     Config section name
     * @return {Promise}
     */
    async start(name) {
        if (name !== this._name)
            throw new Error(`Server ${name} was not properly initialized`);

        try {
            await Array.from(this._app.get('modules')).reduce(
                async (prev, [curName, curModule]) => {
                    await prev;

                    if (!curModule.register)
                        return;

                    let result = curModule.register(name);
                    if (result === null || typeof result !== 'object' || typeof result.then !== 'function')
                        throw new Error(`Module '${curName}' register() did not return a Promise`);
                    return result;
                },
                Promise.resolve()
            );

            this._logger.debug('tracker', 'Starting the server');
            for (let server of this.servers.keys())
                this._reconnect(server);
            this._timeoutTimer = setInterval(() => { this._checkTimeout(); }, 500);
        } catch (error) {
            return this._app.exit(
                this._app.constructor.fatalExitCode,
                error.messages || error.message
            );
        }
    }

    /**
     * Stop the server
     * @param {string} name                     Config section name
     * @return {Promise}
     */
    async stop(name) {
        if (name !== this._name)
            throw new Error(`Server ${name} was not properly initialized`);

        try {
            this._closing = true;
            if (this._timeoutTimer) {
                clearInterval(this._timeoutTimer);
                this._timeoutTimer = null;
            }

            for (let [name, connection] of this._peer.connections) {
                if (!connection.server)
                    continue;

                let [trackerName, connectionName] = name.split('#');
                this.sendStatus(trackerName, connectionName, false);
            }

            await new Promise((resolve, reject) => {
                let counter = 0;
                let done = () => {
                    if (--counter <= 0)
                        this._logger.info(`Trackers disconnected`, resolve);
                };
                try {
                    for (let [name, tracker] of this.servers) {
                        if (!tracker.socket)
                            continue;

                        if (!tracker.connected) {
                            this.onClose(name);
                            continue;
                        }

                        ++counter;
                        tracker.socket.once('close', done);
                        tracker.socket.end();
                    }
                    if (!counter)
                        done();
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            return this._app.exit(
                this._app.constructor.fatalExitCode,
                error.messages || error.message
            );
        }
    }

    /**
     * Get server
     * @param {string} name                 Tracker name
     * @return {object|undefined}
     */
    getServer(name) {
        if (!name)
            name = this.default;
        if (!name)
            return undefined;

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
     * Set master token
     * @param {string} name         Name of the tracker
     * @param {string} token        The token
     * @return {Promise}            Resolves to true on success
     */
    async setMasterToken(name, token) {
        try {
            if (!name)
                name = this.default;

            let configPath = (os.platform() === 'freebsd' ? '/usr/local/etc/bhid' : '/etc/bhid');
            try {
                fs.accessSync(configPath, fs.constants.F_OK);
            } catch (error) {
                throw new Error('No config directory');
            }

            let dirPath = path.join(configPath, 'master');
            try {
                fs.accessSync(dirPath, fs.constants.F_OK);
            } catch (error) {
                fs.mkdirSync(dirPath, 0o700);
            }

            await this._filer.lockWrite(path.join(dirPath, `${name}.token`), token + '\n', {mode: 0o600});
            return true;
        } catch (error) {
            this._logger.error(`Could not set master token for ${name}: ${error.messages || error.message}`);
            return false;
        }
    }

    /**
     * Get master token
     * @param {string} name         Name of the tracker
     * @return {Promise}            Resolves to token or empty string
     */
    async getMasterToken(name) {
        try {
            if (!name)
                name = this.default;

            let configPath = (os.platform() === 'freebsd' ? '/usr/local/etc/bhid' : '/etc/bhid');
            try {
                fs.accessSync(configPath, fs.constants.F_OK);
            } catch (error) {
                throw new Error('No config directory');
            }

            let dirPath = path.join(configPath, 'master');
            try {
                fs.accessSync(dirPath, fs.constants.F_OK);
            } catch (error) {
                fs.mkdirSync(dirPath, 0o700);
            }
            let contents = await this._filer.lockRead(path.join(dirPath, `${name}.token`));
            return contents.trim();
        } catch (error) {
            return '';
        }
    }

    /**
     * Set daemon token for the tracker
     * @param {string} name         Name of the tracker
     * @param {string} token        The token
     * @return {Promise}            Resolves to true on success
     */
    async setDaemonToken(name, token) {
        try {
            if (!name)
                name = this.default;
            let server = this.servers.get(name);
            if (!server)
                return false;

            let configPath = (os.platform() === 'freebsd' ? '/usr/local/etc/bhid' : '/etc/bhid');
            try {
                fs.accessSync(path.join(configPath, 'bhid.conf'), fs.constants.F_OK);
            } catch (error) {
                throw new Error('Could not read bhid.conf');
            }

            this._connectionsList.set(
                name,
                {
                    serverConnections: [],
                    clientConnections: [],
                }
            );
            if (!this._connectionsList.save())
                throw new Error('Could not clear connections');

            let bhidConfig = this._ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));
            for (let section of Object.keys(bhidConfig)) {
                if (!section.endsWith(this.constructor.trackerSection))
                    continue;

                let tracker = section.substr(0, section.length - this.constructor.trackerSection.length);
                if (tracker === name) {
                    bhidConfig[section].token = token;
                    this._logger.debug('tracker', `Tracker ${name} token updated`);
                    break;
                }
            }

            await this._filer.lockWrite(path.join(configPath, 'bhid.conf'), this._ini.stringify(bhidConfig));
            server.token = token;
            this.emit('token', name);
            return true;
        } catch (error) {
            this._logger.error(`Could not set daemon token: ${error.messages || error.message}`);
            return false;
        }
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
        if (!server || !server.connected)
            return;

        if (!data) {
            try {
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.ALIVE,
                });
                data = this.ClientMessage.encode(message).finish();
            } catch (error) {
                this._logger.error(new NError(error, `Tracker.send()`));
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

        if (!connection.server) {
            let connecting = !!connection.trying;
            for (let id of connection.sessionIds) {
                let session = this._peer.sessions.get(id);
                if (session && session.connected) {
                    connecting = false;
                    break;
                }
            }
            if (connecting)
                return;
        }

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
            this._logger.debug('tracker', `Sending STATUS of ${connectionName} to ${trackerName}`);
            let addresses = [];
            let interfaces = os.networkInterfaces();
            for (let iface of Object.keys(interfaces)) {
                for (let alias of interfaces[iface]) {
                    if (alias.internal || [ 'IPv4', 'IPv6' ].indexOf(alias.family) === -1)
                        continue;

                    addresses.push(this.InternalAddress.create({
                        family: alias.family,
                        address: alias.address,
                        port: this._peer.utp.address().port.toString(),
                    }));
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
            this._logger.error(new NError(error, `Tracker.sendStatus()`));
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
            this._logger.debug('tracker', `Sending LOOKUP IDENTITY to ${trackerName}`);
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
            this._logger.error(new NError(error, `Tracker.sendLookupIdentityRequest()`));
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
            this._logger.debug('tracker', `Sending PUNCH REQUEST of ${connectionName} to ${trackerName}`);
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
            this._logger.error(new NError(error, `Tracker.sendPunchRequest()`));
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
            this._logger.debug('tracker', `Incoming message ${message.type} from ${name}`);
            switch (message.type) {
                case this.ServerMessage.Type.INIT_RESPONSE:
                    this.emit('init_response', name, message);
                    break;
                case this.ServerMessage.Type.CONFIRM_RESPONSE:
                    this.emit('confirm_response', name, message);
                    break;
                case this.ServerMessage.Type.CREATE_DAEMON_RESPONSE:
                    this.emit('create_daemon_response', name, message);
                    break;
                case this.ServerMessage.Type.DELETE_DAEMON_RESPONSE:
                    this.emit('delete_daemon_response', name, message);
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
                    this.emit('import_response', name, message);
                    break;
                case this.ServerMessage.Type.ATTACH_RESPONSE:
                    this.emit('attach_response', name, message);
                    break;
                case this.ServerMessage.Type.REMOTE_ATTACH_RESPONSE:
                    this.emit('remote_attach_response', name, message);
                    break;
                case this.ServerMessage.Type.DETACH_RESPONSE:
                    this.emit('detach_response', name, message);
                    break;
                case this.ServerMessage.Type.REMOTE_DETACH_RESPONSE:
                    this.emit('remote_detach_response', name, message);
                    break;
                case this.ServerMessage.Type.TREE_RESPONSE:
                    this.emit('tree_response', name, message);
                    break;
                case this.ServerMessage.Type.CONNECTIONS_LIST_RESPONSE:
                    this.emit('connections_list_response', name, message);
                    break;
                case this.ServerMessage.Type.DAEMONS_LIST_RESPONSE:
                    this.emit('daemons_list_response', name, message);
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
            this._logger.error(new NError(error, 'Tracker.onMessage()'));
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
            this._logger.error(`Tracker ${name} socket error: ${error.messages || error.message}`);
    }

    /**
     * Tracker disconnect handler
     * @param {string} name                 Tracker name
     */
    onClose(name) {
        this._timeouts.delete(name);

        let server = this.servers.get(name);
        if (!server || !server.socket)
            return;

        if (server.connected)
            this._logger.info(`Tracker ${name} disconnected`);

        server.socket.destroy();
        server.socket = null;
        server.wrapper.detach();
        server.connected = false;
        server.registered = false;

        setTimeout(() => this._reconnect(name), this.constructor.reconnectPause);
    }

    /**
     * Client timeout handler
     * @param {string} name                 Tracker name
     */
    onTimeout(name) {
        this._logger.debug('tracker', `Tracker ${name} timeout`);
        this.onClose(name);
    }

    /**
     * Reconnect to the tracker
     * @param {string} name                 Name of the server
     */
    _reconnect(name) {
        if (this._closing)
            return;

        let server = this.servers.get(name);
        if (!server || server.socket)
            return;

        try {
            this._logger.debug('tracker', `Initiating connection to ${name}`);
            server.options.timeout = this.constructor.connectTimeout;
            server.socket = tls.connect(
                server.port,
                server.address,
                server.options,
                () => {
                    this._logger.info(`Connected to tracker ${name}`);
                    server.connected = true;
                    server.socket.setTimeout(0);

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

                    this.emit('connect', name);
                }
            );

            server.socket.on('error', error => { this.onError(name, error); });
            server.socket.on('close', () => { this.onClose(name); });
            server.socket.on('end', () => { server.wrapper.detach(); });
            server.socket.on('timeout', () => { this.onTimeout(name); });
        } catch (error) {
            this._logger.error(new NError(error, `Tracker._reconnect(): ${name}`));
        }
    }

    /**
     * Check socket timeout
     */
    _checkTimeout() {
        let now = Date.now();
        for (let [ name, timestamp ] of this._timeouts) {
            if (!this.servers.has(name)) {
                this._timeouts.delete(name);
                continue;
            }

            if (timestamp.receive && now >= timestamp.receive) {
                timestamp.receive = 0;
                this.onTimeout(name);
                continue;
            }

            if (timestamp.send && now >= timestamp.send) {
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
