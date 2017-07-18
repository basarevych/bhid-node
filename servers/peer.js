/**
 * Peer communications server
 * @module servers/peer
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const uuid = require('uuid');
const UtpNode = require('utp-punch');
const protobuf = require('protobufjs');
const EventEmitter = require('events');
const NError = require('nerror');
const SocketWrapper = require('socket-wrapper');

/**
 * Server for communication with peers
 */
class Peer extends EventEmitter {
    /**
     * Create the service
     * @param {App} app                             Application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {Ini} ini                             Ini service
     * @param {Crypter} crypter                     Crypter service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, ini, crypter, connectionsList) {
        super();

        this.connections = new Map();                       /* full name => {
                                                                    server: true, // we are server
                                                                    name: 'tracker#user@dom/path',
                                                                    tracker: string,
                                                                    registering: boolean, // on tracker
                                                                    registered: boolean,  // on tracker
                                                                    connectAddress: string,
                                                                    connectPort: string,
                                                                    encrypted: boolean,
                                                                    fixed: boolean, // use peers list
                                                                    peers: array, // [ 'tracker#user@dom?daemon' ]
                                                                    sessionIds: Set,
                                                               } or {
                                                                    server: false, // we are client
                                                                    name: 'tracker#user@dom/path',
                                                                    tracker: string,
                                                                    registering: boolean, // on tracker
                                                                    registered: boolean,  // on tracker
                                                                    listenAddress: string,
                                                                    listenPort: string,
                                                                    encrypted: boolean,
                                                                    fixed: boolean, // use peers list
                                                                    peers: array, // [ 'tracker#user@dom?daemon' ]
                                                                    sessionIds: Set,
                                                                    internal: boolean, // connecting/connected to internal address
                                                                    external: boolean, // connecting/connected to external address
                                                                }
                                                             */
        this.sessions = new Map();                           /* id => {
                                                                    id: uuid,
                                                                    name: 'tracker#user@dom/path',
                                                                    socket: socket,
                                                                    wrapper: SocketWrapper(socket),
                                                                    connected: false, // socket connected
                                                                    verified: false, // peer is verified
                                                                    accepted: false, // peer has verified us
                                                                    established: false, // announced as established
                                                                    closing: false, // do not attempt to reconnect
                                                                }
                                                             */
        this.utp = null;

        this._name = null;
        this._utpPort = 42049;
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._ini = ini;
        this._crypter = crypter;
        this._connectionsList = connectionsList;
        this._timeouts = new Map();
    }

    /**
     * Service name is 'servers.peer'
     * @type {string}
     */
    static get provides() {
        return 'servers.peer';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'ini', 'crypter', 'connectionsList' ];
    }

    /**
     * Tracker address response timeout
     * @type {number}
     */
    static get addressTimeout() {
        return 10 * 1000; // ms
    }

    /**
     * Connect timeout
     * @type {number}
     */
    static get connectTimeout() {
        return 5 * 1000; // ms
    }

    /**
     * Finish handshake timeout
     * @type {number}
     */
    static get establishTimeout() {
        return 15 * 1000; // ms
    }

    /**
     * Failed connect retry timeout
     * @type {number}
     */
    static get failureTimeout() {
        return 10 * 1000; // ms
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
     * Number of punching packets
     * @type {number}
     */
    static get punchingAttempts() {
        return 10;
    }

    /**
     * Initialize the server
     * @param {string} name                     Config section name
     * @return {Promise}
     */
    init(name) {
        this._name = name;

        return new Promise((resolve, reject) => {
                this._logger.debug('peer', 'Loading protocol');
                protobuf.load(path.join(this._config.base_path, 'proto', 'daemon.proto'), (error, root) => {
                    if (error)
                        return reject(new NError(error, 'Peer.init()'));

                    try {
                        this.proto = root;
                        this.ConnectRequest = this.proto.lookup('daemon.ConnectRequest');
                        this.ConnectResponse = this.proto.lookup('daemon.ConnectResponse');
                        this.EncryptedData = this.proto.lookup('daemon.EncryptedData');
                        this.InnerMessage = this.proto.lookup('daemon.InnerMessage');
                        this.OuterMessage = this.proto.lookup('daemon.OuterMessage');

                        resolve();
                    } catch (error) {
                        reject(new NError(error, 'Peer.init()'));
                    }
                });
            })
            .then(() => {
                let configPath = (os.platform() === 'freebsd' ? '/usr/local/etc/bhid' : '/etc/bhid');
                try {
                    fs.accessSync(path.join(configPath, 'bhid.conf'), fs.constants.F_OK);
                } catch (error) {
                    throw new Error('Could not read bhid.conf');
                }

                let bhidConfig = this._ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));

                if (bhidConfig.daemon && bhidConfig.daemon.port) {
                    this._utpPort = parseInt(bhidConfig.daemon.port);
                    if (isNaN(this._utpPort))
                        throw new Error('Invalid UDP daemon port in config');
                }

                let mtu = bhidConfig.daemon && bhidConfig.daemon.mtu;
                if (mtu) {
                    mtu = parseInt(mtu);
                    if (isNaN(mtu) || mtu < 21)
                        throw new Error('Invalid MTU value in config');
                    mtu -= 20;
                }
                this.utp = new UtpNode({ timeout: 0, mtu: mtu || 1000 }, this.onConnection.bind(this));

                this.publicKey = fs.readFileSync(path.join(configPath, 'id', 'public.rsa'), 'utf8');
                this.privateKey = fs.readFileSync(path.join(configPath, 'id', 'private.rsa'), 'utf8');
                this._crypter.init(this.publicKey, this.privateKey);
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
                this._logger.debug('peer', 'Starting the server');

                return new Promise((resolve, reject) => {
                    let onError = error => {
                        reject(error.code === 'EADDRINUSE' ? new Error(`Could not bind UDP daemon socket to port ${this._utpPort}`) : error);
                    };
                    try {
                        this.utp.once('error', onError);
                        this.utp.once('listening', () => {
                            this.utp.removeListener('error', onError);
                            this._logger.debug('peer', 'UDP socket started');
                            resolve();
                        });
                        this._logger.debug('peer', 'Initiating UDP socket');
                        this.utp.bind(this._utpPort);
                        this.utp.listen();
                    } catch (error) {
                        reject(error);
                    }
                });
            })
            .then(() => {
                if (!this._connectionsList.load())
                    throw new Error('Could not load connections');
                this._timeoutTimer = setInterval(this._checkTimeout.bind(this), 500);
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

        if (this._timeoutTimer) {
            clearInterval(this._timeoutTimer);
            this._timeoutTimer = null;
        }

        return new Promise((resolve, reject) => {
            let counter = 0;
            let done = () => {
                if (--counter <= 0)
                    this._logger.info(`Peers dropped`, () => { resolve(); });
            };
            try {
                for (let [ id, session ] of this.sessions) {
                    session.closing = true;
                    if (session.connected) {
                        ++counter;
                        session.socket.once('close', done);
                        session.socket.end();
                        session.wrapper.detach();
                    } else {
                        this.onClose(id);
                    }
                }
                this.utp.close();
                if (!counter)
                    done();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Open server connection
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {object} options
     * @param {string} options.connectAddress   Connect front to
     * @param {string} options.connectPort      Connect front to
     * @param {string} options.encrypted        Is encryption is required
     * @param {string} options.fixed            Is clients list is fixed
     * @param {string[]} options.peers          List of allowed peers when fixed
     */
    openServer(tracker, name, { connectAddress, connectPort, encrypted, fixed, peers }) {
        let fullName = tracker + '#' + name;
        if (this.connections.has(fullName))
            return;

        this._logger.debug('peer', `Starting ${fullName}`);
        try {
            let connection = {
                server: true,
                name: fullName,
                tracker: tracker,
                registering: false,
                registered: false,
                connectAddress: connectAddress,
                connectPort: connectPort,
                encrypted: encrypted,
                fixed: fixed,
                peers: peers,
                sessionIds: new Set(),
            };
            this.connections.set(fullName, connection);
            this._tracker.sendStatus(tracker, name);
        } catch (error) {
            this._logger.error(new NError(error, 'Peer.openServer()'));
        }
    }

    /**
     * Open client connection
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {object} options
     * @param {string} options.listenAddress    Front listen on
     * @param {string} options.listenPort       Front listen on
     * @param {string} options.encrypted        Is encryption is required
     * @param {string} options.fixed            Is clients list is fixed
     * @param {string[]} options.peers          List of allowed peers when fixed
     */
    openClient(tracker, name, { listenAddress, listenPort, encrypted, fixed, peers }) {
        let fullName = tracker + '#' + name;
        if (this.connections.has(fullName))
            return;

        this._logger.debug('peer', `Starting ${fullName}`);
        try {
            let connection = {
                server: false,
                name: fullName,
                tracker: tracker,
                registering: false,
                registered: false,
                listenAddress: listenAddress,
                listenPort: listenPort,
                encrypted: encrypted,
                fixed: fixed,
                peers: peers,
                sessionIds: new Set(),
                internal: false,
                external: false,
            };
            this.connections.set(fullName, connection);
            this._tracker.sendStatus(tracker, name);
        } catch (error) {
            this._logger.error(new NError(error, 'Peer.openClient()'));
        }
    }

    /**
     * Close connection
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     */
    close(tracker, name) {
        let fullName = tracker + '#' + name;
        let connection = this.connections.get(fullName);
        if (!connection)
            return;

        this._logger.debug('peer', `Closing ${fullName}`);
        for (let id of connection.sessionIds) {
            let session = this.sessions.get(id);
            if (session) {
                session.closing = true;
                session.socket.end();
                session.wrapper.detach();
            }
        }

        this._tracker.sendStatus(tracker, name, false);
        this.connections.delete(fullName);
    }

    /**
     * Connect to server
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} type                     'internal' or 'external'
     * @param {object[]} addresses              Server addresses: [ { address, port } ]
     */
    connect(tracker, name, type, addresses) {
        let fullName = tracker + '#' + name;
        let connection = this.connections.get(fullName);
        if (!connection || connection.server || connection.internal || connection.external || !addresses.length)
            return;

        connection[type] = true;

        let doConnect = (address, port) => {
            try {
                this._logger.info(`Initiating ${type} connection to ${fullName} (${address}:${port})`);
                let session, socket = this.utp.connect(
                    port,
                    address,
                    () => {
                        session.connected = true;
                        for (let id of connection.sessionIds) {
                            if (id === session.id)
                                continue;

                            let other = this.sessions.get(id);
                            if (other) {
                                other.closing = true;
                                this.onClose(id);
                            }
                        }

                        this._timeouts.set(
                            session.id,
                            {
                                establish: Date.now() + this.constructor.establishTimeout,
                            }
                        );

                        this._logger.info(`Connected to ${type} address of ${fullName} (${address}:${port})`);
                        this.emit('connect', session.id);
                    }
                );

                session = this.createSession(fullName, socket);
                connection.sessionIds.add(session.id);

                this._timeouts.set(
                    session.id,
                    {
                        connect: Date.now() + this.constructor.connectTimeout,
                    }
                );
            } catch (error) {
                this._logger.error(new NError(error, `Peer.connect(): ${fullName}`));
            }
        };

        if (type === 'internal') {
            for (let host of addresses)
                doConnect(host.address, host.port);
        } else if (type === 'external') {
            let address = addresses[0].address;
            let port = addresses[0].port;
            this._logger.debug('peer', `Punching ${fullName}: ${address}:${port}`);
            this.utp.punch(this.constructor.punchingAttempts, port, address, success => {
                if (success)
                    return doConnect(address, port);

                this._logger.info(`Could not open NAT of ${name} (${address}:${port})`);
                connection.external = false;
                setTimeout(() => { this._tracker.sendStatus(tracker, name); }, this.constructor.failureTimeout);
            });
        }
    }

    /**
     * Create UTP session
     * @param {string|null} name                Connection full name
     * @param {object} socket                   Established socket
     * @return {object}
     */
    createSession(name, socket) {
        let sessionId = uuid.v1();
        let session = {
            id: sessionId,
            name: name,
            socket: socket,
            wrapper: new SocketWrapper(socket),
            connected: false,
            verified: false,
            accepted: false,
            established: false,
            closing: false,
        };
        this.sessions.set(sessionId, session);
        this._crypter.create(sessionId, name);

        session.socket.on('error', error => {
            this.onError(sessionId, error);
        });
        session.socket.on('close', () => {
            this.onClose(sessionId);
        });
        session.socket.on('end', () => {
            session.wrapper.detach();
        });

        session.wrapper.on(
            'receive',
            data => {
                if (!this.onMessage(sessionId, data)) {
                    session.socket.end();
                    session.wrapper.detach();
                }
            }
        );
        session.wrapper.on(
            'read',
            data => {
                let timeout = this._timeouts.get(sessionId);
                if (timeout)
                    timeout.receive = Date.now() + this.constructor.pongTimeout;
            }
        );
        session.wrapper.on(
            'flush',
            data => {
                let timeout = this._timeouts.get(sessionId);
                if (timeout)
                    timeout.send = Date.now() + this.constructor.pingTimeout;
            }
        );

        return session;
    }

    /**
     * Send data to peer
     * @param {string} sessionId                Session ID
     * @param {Buffer|null} data                Message
     * @param {boolean} [end]                   End socket
     */
    send(sessionId, data, end) {
        let session = this.sessions.get(sessionId);
        if (!session)
            return;

        if (!data) {
            try {
                let message = this.OuterMessage.create({
                    type: this.OuterMessage.Type.ALIVE,
                });
                data = this.OuterMessage.encode(message).finish();
            } catch (error) {
                this._logger.error(new NError(error, `Peer.send()`));
                return;
            }
        }

        if (end) {
            session.wrapper.once('flush', () => {
                session.socket.end();
                session.wrapper.detach();
            });
        }

        session.wrapper.send(data);
    }

    /**
     * Send request for establishing connection
     * @param {string} sessionId                Session ID
     */
    sendConnectRequest(sessionId) {
        let session = this.sessions.get(sessionId);
        if (!session)
            return;

        let connection = this.connections.get(session.name);
        if (!connection)
            return;

        let cryptSession = this._crypter.sessions.get(sessionId);
        if (!cryptSession)
            return;

        try {
            let request = this.ConnectRequest.create({
                connectionName: connection.name,
                identity: this._crypter.identity,
                publicKey: cryptSession.publicKey,
                signature: this._crypter.sign(cryptSession.publicKey),
                encrypted: connection.encrypted,
            });
            let msg = this.OuterMessage.create({
                type: this.OuterMessage.Type.CONNECT_REQUEST,
                connectRequest: request,
            });
            let data = this.OuterMessage.encode(msg).finish();
            this.send(sessionId, data);
        } catch (error) {
            this._logger.error(new NError(error, 'Peer.sendConnectRequest()'));
        }
    }

    /**
     * Send inner message to a peer
     * @param {string} name                     Connection full name
     * @param {string} sessionId                Session ID
     * @param {*} data                          Message
     */
    sendInnerMessage(name, sessionId, data) {
        let connection = this.connections.get(name);
        if (!connection)
            return;

        try {
            let message;
            if (connection.encrypted) {
                let result = this._crypter.encrypt(sessionId, data);
                if (!result)
                    throw new Error('Could not encrypt');

                let msg = this.EncryptedData.create({
                    nonce: result.nonce,
                    payload: result.encrypted,
                });
                message = this.OuterMessage.create({
                    type: this.OuterMessage.Type.DATA,
                    encryptedMessage: msg,
                });
            } else {
                message = this.OuterMessage.create({
                    type: this.OuterMessage.Type.DATA,
                    message: data,
                });
            }
            let buffer = this.OuterMessage.encode(message).finish();
            this.send(sessionId, buffer);
        } catch (error) {
            this._logger.error(new NError(error, `Peer.sendInnerMessage(): ${name}`));
        }
    }

    /**
     * Incoming connection handler
     * @param {object} socket                   Client socket
     */
    onConnection(socket) {
        this._logger.debug('peer', `Incoming daemon socket from ${socket.address().address}:${socket.address().port}`);
        let session = this.createSession(null, socket);
        session.connected = true;

        this._timeouts.set(
            session.id,
            {
                establish: Date.now() + this.constructor.establishTimeout,
            }
        );

        this.emit('connection', session.id);
    }

    /**
     * Peer message handler
     * @param {string} sessionId                Session ID
     * @param {Buffer} data                     Message
     */
    onMessage(sessionId, data) {
        let session = this.sessions.get(sessionId);
        if (!session)
            return false;

        let connection;
        if (session.name) {
            connection = this.connections.get(session.name);
            if (!connection)
                return false;
        }

        let message;
        try {
            message = this.OuterMessage.decode(data);
            if (message.type === this.OuterMessage.Type.ALIVE)
                return true;
        } catch (error) {
            this._logger.error(`Peer ${session.name} protocol error: ${error.message}`);
            return false;
        }

        try {
            this._logger.debug('peer', `Incoming message for ${session.name}: ${message.type}`);
            if (message.type === this.OuterMessage.Type.BYE) {
                this._logger.debug('peer', `Received BYE from ${session.name}`);
                return false;
            } else {
                if (!connection || !session.established) {
                    switch (message.type) {
                        case this.OuterMessage.Type.CONNECT_REQUEST:
                            this.emit('connect_request', sessionId, message);
                            break;
                        case this.OuterMessage.Type.CONNECT_RESPONSE:
                            this.emit('connect_response', sessionId, message);
                            break;
                    }
                } else {
                    switch (message.type) {
                        case this.OuterMessage.Type.DATA:
                            this.emit('data', sessionId, message);
                            break;
                    }
                }
            }
        } catch (error) {
            this._logger.error(new NError(error, 'Peer.onMessage()'));
        }

        return true;
    }

    /**
     * Socket error handler
     * @param {string} sessionId                Session ID
     * @param {Error} error                     Error
     */
    onError(sessionId, error) {
        let session = this.sessions.get(sessionId);
        if (session)
            this._logger.error(`Peer ${session.name} socket error: ${error.fullStack || error.stack}`);
    }

    /**
     * Socket termination handler
     * @param {string} sessionId                Session ID
     */
    onClose(sessionId) {
        this._timeouts.delete(sessionId);

        let cryptSession = this._crypter.sessions.get(sessionId);
        this._crypter.destroy(sessionId);

        let session = this.sessions.get(sessionId);
        if (!session)
            return;

        this._logger.info(`Peer ${(cryptSession && cryptSession.peerName) || 'unknown'} of ${session.name || 'unknown'} disconnected`);

        let address = session.socket.address();
        session.socket.destroy();
        session.wrapper.destroy();

        this.sessions.delete(sessionId);

        if (!session.name)
            return;

        let [ tracker, connectionName ] = session.name.split('#');

        if (session.established) {
            this._logger.info(`Socket for ${session.name} disconnected`);
            let trackedConnections = this._connectionsList.get(tracker);
            if (trackedConnections) {
                let serverInfo = trackedConnections.serverConnections.get(connectionName);
                if (serverInfo && serverInfo.connected > 0)
                    serverInfo.connected--;
                let clientInfo = trackedConnections.clientConnections.get(connectionName);
                if (clientInfo && clientInfo.connected > 0)
                    clientInfo.connected--;
            }
        }

        let connection = this.connections.get(session.name);
        if (!connection)
            return;

        connection.sessionIds.delete(sessionId);

        if (connection.server) {
            if (session.established)
                this._tracker.sendStatus(tracker, connectionName);
        } else if (!session.closing && connection.sessionIds.size === 0) {
            let reconnect;
            if (connection.internal)
                reconnect = session.established ? 'internal' : 'external';
            else if (connection.external && session.established)
                reconnect = 'external';

            connection.internal = false;
            connection.external = false;

            if (reconnect === 'external') {
                setTimeout(
                    () => {
                        if (!connection.internal && !connection.external)
                            this._tracker.sendStatus(tracker, connectionName);
                    },
                    this.constructor.addressTimeout
                );
                this._tracker.sendPunchRequest(tracker, connectionName);
            } else if (reconnect === 'internal') {
                this.connect(tracker, connectionName, 'internal', [ address ]);
            }
        }
    }

    /**
     * Socket timeout handler
     * @param {string} sessionId                Session ID
     */
    onTimeout(sessionId) {
        let session = this.sessions.get(sessionId);
        if (!session)
            return;

        let cryptSession = this._crypter.sessions.get(sessionId);
        this._logger.debug('peer', `Socket timeout for ${(cryptSession && cryptSession.peerName) || 'unknown'} of ${session.name || 'unknown'}`);
        this.onClose(sessionId);
    }

    /**
     * Check socket timeout
     */
    _checkTimeout() {
        let now = Date.now();
        for (let [ id, timestamp ] of this._timeouts) {
            let session = this.sessions.get(id);
            if (!session) {
                this._timeouts.delete(id);
                continue;
            }

            if (timestamp.connect && now >= timestamp.connect) {
                timestamp.connect = 0;
                if (!session.connected) {
                    this.onTimeout(id);
                    continue;
                }
            }

            if (timestamp.establish && now >= timestamp.establish) {
                timestamp.establish = 0;
                if (!session.established) {
                    let data = null;
                    try {
                        let message = this.OuterMessage.create({
                            type: this.OuterMessage.Type.BYE,
                        });
                        data = this.OuterMessage.encode(message).finish();
                    } catch (error) {
                        this._logger.error(new NError(error, `Peer._checkTimeout()`));
                    }

                    this.send(id, data, true);
                    continue;
                }
            }

            if (timestamp.receive && now >= timestamp.receive) {
                timestamp.receive = 0;
                this.onTimeout(id);
                continue;
            }

            if (timestamp.send && now >= timestamp.send) {
                timestamp.send = 0;
                this.send(id, null);
            }
        }
    }

    /**
     * Retrieve tracker server
     * @return {Tracker}
     */
    get _tracker() {
        if (this._tracker_instance)
            return this._tracker_instance;
        this._tracker_instance = this._app.get('servers').get('tracker');
        return this._tracker_instance;
    }
}

module.exports = Peer;