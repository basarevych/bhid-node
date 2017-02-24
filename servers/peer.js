/**
 * Peer communications server
 * @module servers/peer
 */
const debug = require('debug')('bhid:peer');
const path = require('path');
const fs = require('fs');
const uuid = require('uuid');
const utp = require('utp-punch');
const protobuf = require('protobufjs');
const EventEmitter = require('events');
const WError = require('verror').WError;
const SocketWrapper = require('socket-wrapper');

/**
 * Server class
 */
class Peer extends EventEmitter {
    /**
     * Create the service
     * @param {App} app                             Application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {Crypter} crypter                     Crypter service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, crypter, connectionsList) {
        super();

        this.connections = new Map();
        this.sessions = new Map();

        this._name = null;
        this._app = app;
        this._config = config;
        this._logger = logger;
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
        return [ 'app', 'config', 'logger', 'modules.peer.crypter', 'modules.peer.connectionsList' ];
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
        return 3 * 1000; // ms
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
                debug('Loading protocol');
                protobuf.load(path.join(this._config.base_path, 'proto', 'daemon.proto'), (error, root) => {
                    if (error)
                        return reject(new WError(error, 'Peer.init()'));

                    try {
                        this.proto = root;
                        this.ConnectRequest = this.proto.lookup('daemon.ConnectRequest');
                        this.ConnectResponse = this.proto.lookup('daemon.ConnectResponse');
                        this.EncryptedData = this.proto.lookup('daemon.EncryptedData');
                        this.InnerMessage = this.proto.lookup('daemon.InnerMessage');
                        this.OuterMessage = this.proto.lookup('daemon.OuterMessage');

                        resolve();
                    } catch (error) {
                        reject(new WError(error, 'Peer.init()'));
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

                this.publicKey = fs.readFileSync(path.join(configPath, 'id', 'public.rsa'), 'utf8');
                this.privateKey = fs.readFileSync(path.join(configPath, 'id', 'private.rsa'), 'utf8');
                this._crypter.init(this.publicKey, this.privateKey);
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
                this._connectionsList.load();
                this._timeoutTimer = setInterval(() => { this._checkTimeout(); }, 500);
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
     * @param {string[]} options.peers          List of clients
     */
    openServer(tracker, name, { connectAddress, connectPort, encrypted, fixed, peers }) {
        let fullName = tracker + '#' + name;
        if (this.connections.has(fullName))
            return;

        debug(`Starting ${fullName}`);
        try {
            let connection = {
                server: true,
                name: fullName,
                tracker: tracker,
                peerId: null,
                registering: false,
                registered: false,
                connectAddress: connectAddress,
                connectPort: connectPort,
                encrypted: encrypted,
                fixed: fixed,
                peers: peers,
                utp: null,
                sessions: new Set(),
            };
            this.connections.set(fullName, connection);

            let server = utp.createServer(socket => { this.onConnection(fullName, socket); });
            new Promise((resolveBind, rejectBind) => {
                    debug('Initiating server socket');
                    server.bind();
                    server.once('error', error => { rejectBind(error); });
                    server.listen(() => { resolveBind(); })
                })
                .then(() => {
                    debug(`Network server for ${fullName} started`);
                    connection.utp = server;
                    this._tracker.sendStatus(tracker, name);
                })
                .catch(error => {
                    this.connections.delete(fullName);
                    this._logger.error(new WError(error, 'Peer.openServer()'));
                });
        } catch (error) {
            this._logger.error(new WError(error, 'Peer.openServer()'));
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
     * @param {string[]} options.peers          List of clients
     */
    openClient(tracker, name, { listenAddress, listenPort, encrypted, fixed, peers }) {
        let fullName = tracker + '#' + name;
        if (this.connections.has(fullName))
            return;

        debug(`Starting ${fullName}`);
        let connection = {
            server: false,
            name: fullName,
            tracker: tracker,
            peerId: null,
            registering: false,
            registered: false,
            listenAddress: listenAddress,
            listenPort: listenPort,
            encrypted: encrypted,
            fixed: fixed,
            peers: peers,
            sessions: new Set(),
            sessionId: null,
            internal: false,
            external: false,
        };
        this.connections.set(fullName, connection);
        this._tracker.sendStatus(tracker, name);
    }

    /**
     * Close connection
     * @param {string} name             Connection name
     */
    close(name) {
        let connection = this.connections.get(name);
        if (!connection)
            return;

        debug(`Closing ${name}`);
        for (let id of connection.sessions) {
            let session = this.sessions.get(id);
            if (session) {
                session.closing = true;
                this.onClose(name, id);
            }
        }

        this._tracker.sendStatus(connection.tracker, name, false);

        this.connections.delete(name);

        if (connection.utp)
            connection.utp.close();
    }

    /**
     * Connect to server
     * @param {string} name             Connection name
     * @param {string} type             'internal' or 'external'
     * @param {object[]} addresses      Server addresses: { address, port }
     */
    connect(name, type, addresses) {
        let connection = this.connections.get(name);
        if (!connection || connection.server || connection.internal || connection.external)
            return;

        connection[type] = true;

        let doConnect = (sessionId, address, port) => {
            try {
                this._logger.info(`Initiating ${type} connection to ${name} (${address}:${port})`);
                let session = this.sessions.get(sessionId);
                if (!session)
                    return;

                session.address = address;
                session.port = port;
                session.socket = session.utp.connect(
                    port,
                    address,
                    () => {
                        if (!this.sessions.has(sessionId)) {
                            session.socket.end();
                            session.wrapper.detach();
                            return;
                        }

                        session.wrapper.removeAllListeners();
                        session.wrapper.attach(session.socket);

                        session.wrapper.on(
                            'receive',
                            data => {
                                if (!this.onMessage(name, sessionId, data)) {
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

                        this._logger.info(`Connected to ${type} address of ${name}`);
                        this._timeouts.set(
                            sessionId,
                            {
                                send: Date.now() + this.constructor.pingTimeout,
                                receive: Date.now() + this.constructor.pongTimeout,
                                name: name,
                            }
                        );

                        session.establishedTimer = setTimeout(() => {
                            session.establishedTimer = null;
                            this._checkSession(name, sessionId);
                        }, this.constructor.connectTimeout);

                        this.emit('connection', name, sessionId);
                    }
                );
                this._timeouts.set(
                    sessionId,
                    {
                        send: 0,
                        receive: Date.now() + this.constructor.connectTimeout,
                        name: name,
                    }
                );

                session.socket.on('error', error => {
                    this.onError(name, sessionId, error);
                });
                session.socket.on('close', () => {
                    this.onClose(name, sessionId);
                });
            } catch (error) {
                this._logger.error(new WError(error, `Peer.connect(): ${name}`));
            }
        };

        if (type === 'internal') {
            for (let host of addresses)
                this.createSession(name, sessionId => { doConnect(sessionId, host.address, host.port); });
        } else if (type === 'external') {
            this.createSession(name, sessionId => {
                let address = addresses[0].address;
                let port = addresses[0].port;
                let session = this.sessions.get(sessionId);
                debug(`Punching ${name}: ${address}:${port}`);
                session.utp.punch(this.constructor.punchingAttempts, port, address, success => {
                    if (success)
                        return doConnect(sessionId, address, port);

                    this._logger.info(`Could not open NAT of ${name}`);
                    this.onClose(name, sessionId);
                });
            });
        }
    }

    /**
     * Create UTP session and run callback
     * @param {string} name                     Connection name
     * @param {function} cb                     Callback
     */
    createSession(name, cb) {
        let connection = this.connections.get(name);
        if (!connection || connection.server)
            return;

        if (!connection.internal && connection.sessions.size) {
            let sessionId = connection.sessions.values().next().value;
            return cb(sessionId);
        }

        let sessionId = this._crypter.create(name);
        let session = {
            sessionId: sessionId,
            name: name,
            utp: utp.createClient(),
            socket: null,
            wrapper: new SocketWrapper(),
            verified: false,
            accepted: false,
        };
        this.sessions.set(sessionId, session);
        connection.sessions.add(sessionId);

        let onError = error => {
            session.utp = null;
            connection.sessions.delete(sessionId);
            this.sessions.delete(sessionId);
            this._crypter.destroy(sessionId);
            setTimeout(() => {
                this.createSession(name, cb);
            }, 1000);
        };

        session.utp.once('error', onError);
        session.utp.once('bound', () => {
            session.utp.removeListener('error', onError);
            cb(sessionId);
        });

        session.utp.bind();
    }

    /**
     * Drop extra sessions
     * @param {string} name             Connection name
     */
    dropExtra(name) {
        let connection = this.connections.get(name);
        if (!connection || connection.server)
            return;

        for (let id of connection.sessions) {
            if (id == connection.sessionId)
                continue;
            let session = this.sessions.get(id);
            if (session) {
                session.closing = true;
                this.onClose(name, id);
            }
        }
    }

    /**
     * Send data to peer
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     * @param {Buffer|null} data                Message
     * @param {boolean} [end]                   End socket
     */
    send(name, sessionId, data, end) {
        let connection = this.connections.get(name);
        if (!connection)
            return;

        let session = this.sessions.get(sessionId);
        if (!session)
            return;

        if (!session.wrapper) {
            if (end === true && session.socket)
                session.socket.end();
            return;
        }

        if (!data) {
            try {
                let message = this.OuterMessage.create({
                    type: this.OuterMessage.Type.ALIVE,
                });
                data = this.OuterMessage.encode(message).finish();
            } catch (error) {
                this._logger.error(new WError(error, `Peer.send()`));
                return;
            }
        }

        if (end === true && session.socket) {
            session.wrapper.once('flush', () => {
                session.wrapper.detach();
                session.socket.end();
            });
        }

        session.wrapper.send(data);
    }

    /**
     * Send inner message to a peer
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     * @param {*} data                          Message
     */
    sendInnerMessage(name, sessionId, data) {
        let connection = this.connections.get(name);
        if (!connection)
            return;

        if (!data.length)
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
            this.send(name, sessionId, buffer);
        } catch (error) {
            this._logger.error(new WError(error, `Peer.sendInnerMessage(): ${name}`));
        }
    }

    /**
     * Connection handler
     * @param {string} name                     Connection name
     * @param {object} socket                   Client socket
     */
    onConnection(name, socket) {
        let connection = this.connections.get(name);
        if (!connection) {
            socket.end();
            return;
        }

        let sessionId = this._crypter.create(name);
        let session = {
            sessionId: sessionId,
            name: name,
            socket: socket,
            wrapper: new SocketWrapper(socket),
            verified: false,
            accepted: false,
        };
        this._timeouts.set(
            sessionId,
            {
                send: Date.now() + this.constructor.pingTimeout,
                receive: Date.now() + this.constructor.pongTimeout,
                name: name,
            }
        );
        this.sessions.set(sessionId, session);
        connection.sessions.add(sessionId);

        session.wrapper.on(
            'receive',
            data => {
                if (!this.onMessage(name, sessionId, data)) {
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

        session.socket.on('error', error => { this.onError(name, sessionId, error); });
        session.socket.on('close', () => { this.onClose(name, sessionId); });

        this._logger.info(`New connection for ${name} from ${socket.address().address}:${socket.address().port}`);
        this.emit('connection', name, sessionId);
    }

    /**
     * Peer message handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     * @param {Buffer} data                     Message
     */
    onMessage(name, sessionId, data) {
        let connection = this.connections.get(name);
        if (!connection)
            return false;

        let session = this.sessions.get(sessionId);
        if (!session)
            return false;

        if (!data || !data.length)
            return true;

        let message;
        try {
            message = this.OuterMessage.decode(data);
            if (message.type === this.OuterMessage.Type.ALIVE)
                return true;
        } catch (error) {
            this._logger.error(`Peer ${name} protocol error: ${error.message}`);
            return false;
        }

        try {
            debug(`Incoming message for ${name}: ${message.type}`);
            if (message.type === this.OuterMessage.Type.BYE) {
                debug(`Received BYE from ${name}`);
                return false;
            } else {
                if (!session.verified || !session.accepted) {
                    switch (message.type) {
                        case this.OuterMessage.Type.CONNECT_REQUEST:
                            this.emit('connect_request', name, sessionId, message);
                            break;
                        case this.OuterMessage.Type.CONNECT_RESPONSE:
                            this.emit('connect_response', name, sessionId, message);
                            break;
                    }
                } else {
                    switch (message.type) {
                        case this.OuterMessage.Type.DATA:
                            this.emit('data', name, sessionId, message);
                            break;
                    }
                }
            }
        } catch (error) {
            this._logger.error(new WError(error, 'Peer.onMessage()'));
        }

        return true;
    }

    /**
     * Socket error handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     * @param {Error} error                     Error
     */
    onError(name, sessionId, error) {
        this._logger.error(`Peer ${name} socket error: ${error.message}`);
    }

    /**
     * Socket termination handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     */
    onClose(name, sessionId) {
        this._timeouts.delete(sessionId);
        this._crypter.destroy(sessionId);

        let established = false, reconnect;

        let connection = this.connections.get(name);
        let session = this.sessions.get(sessionId);
        if (connection) {
            if (connection.server)
                established = session && session.verified && session.accepted;
            else
                established = (connection.sessionId == sessionId);

            connection.sessions.delete(sessionId);

            if (established) {
                this._front.close(name, sessionId);
                if (!connection.server)
                    connection.sessionId = null;
                if (connection.external)
                    reconnect = 'external';
                else if (connection.internal)
                    reconnect = 'internal';
            } else {
                if (connection.internal && connection.sessions.size === 0)
                    reconnect = 'external';
            }
        }

        if (!session)
            return;

        this.sessions.delete(sessionId);

        if (session.establishedTimer)
            clearTimeout(session.establishedTimer);
        if (session.punchingTimer)
            clearTimeout(session.punchingTimer);

        if (session.socket) {
            if (!session.socket.destroyed)
                session.socket.destroy();
            session.socket = null;
            session.wrapper.detach();
        }
        if (session.utp) {
            session.utp.close();
            session.utp = null;
        }

        let parts = name.split('#');
        if (parts.length != 2)
            return;

        let tracker = parts[0];
        let connectionName = parts[1];

        debug(`Socket for ${name} disconnected`);
        if (established) {
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

        if (session.closing)
            return;

        if (connection.server) {
            this._tracker.sendStatus(tracker, connectionName);
        } else {
            if (reconnect === 'external') {
                if (connection.sessions.size === 0) {
                    connection.internal = false;
                    connection.external = false;
                }
                session.punchingTimer = setTimeout(
                    () => {
                        session.punchingTimer = null;
                        if (!connection.internal && !connection.external)
                            this._tracker.sendStatus(tracker, connectionName);
                    },
                    this.constructor.addressTimeout
                );
                this._tracker.sendPunchRequest(tracker, connectionName);
            } else if (reconnect === 'internal') {
                if (connection.sessions.size === 0) {
                    connection.internal = false;
                    connection.external = false;
                }
                this.connect(name, 'internal', [ { address: session.address, port: session.port } ]);
            } else {
                this._logger.info(`Connection to ${name} failed`);
                setTimeout(() => {
                    if (connection.sessions.size === 0) {
                        connection.internal = false;
                        connection.external = false;
                    }
                    this._tracker.sendStatus(tracker, connectionName);
                }, 1000);
            }
        }
    }

    /**
     * Socket timeout handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     */
    onTimeout(name, sessionId) {
        debug(`Socket timeout for ${name}`);
        this.onClose(name, sessionId);
    }

    /**
     * Check if session is verified and accepted
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     */
    _checkSession(name, sessionId) {
        let session = this.sessions.get(sessionId);
        if (!session)
            return;

        if (!session.verified || !session.accepted)
            this.onTimeout(name, sessionId);
    }

    /**
     * Check socket timeout
     */
    _checkTimeout() {
        let now = Date.now();
        for (let [ id, timestamp ] of this._timeouts) {
            if (!id)
                continue;

            if (timestamp.receive !== 0 && now >= timestamp.receive) {
                timestamp.receive = 0;
                timestamp.send = 0;
                this.onTimeout(timestamp.name, id);
            } else if (timestamp.send !== 0 && now >= timestamp.send) {
                this.send(timestamp.name, id, null);
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

    /**
     * Retrieve front server
     * @return {Front}
     */
    get _front() {
        if (this._front_instance)
            return this._front_instance;
        this._front_instance = this._app.get('servers').get('front');
        return this._front_instance;
    }
}

module.exports = Peer;