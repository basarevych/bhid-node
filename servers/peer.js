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
     * @param {Runner} runner                       Runner service
     * @param {Ini} ini                             Ini service
     * @param {Crypter} crypter                     Crypter service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, runner, ini, crypter, connectionsList) {
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
                                                                    fixed: boolean, // use peers list and no identity change
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
                                                                    fixed: boolean, // use peers list and no identity change
                                                                    peers: array, // [ 'tracker#user@dom?daemon' ]
                                                                    sessionIds: Set,
                                                                    internal: array, // addresses
                                                                    external: string, // address
                                                                    trying: string, // null, 'internal' or 'external'
                                                                    successful: boolean, // connected and authenticated
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
                                                                }
                                                             */
        this.utp = null;

        this._name = null;
        this._closing = false;
        this._utpPort = 42049;
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._runner = runner;
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
        return [ 'app', 'config', 'logger', 'runner', 'ini', 'crypter', 'connectionsList' ];
    }

    /**
     * Tracker address response timeout
     * @type {number}
     */
    static get addressTimeout() {
        return 5 * 1000; // ms
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
        return 10 * 1000; // ms
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
     * Close connection timeout
     * @type {number}
     */
    static get closeTimeout() {
        return 3 * 1000; // ms
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

        let configPath;
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
                configPath = (os.platform() === 'freebsd' ? '/usr/local/etc/bhid' : '/etc/bhid');
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
                this.utp = new UtpNode(
                    {
                        timeout: 0,
                        mtu: mtu || 1000,
                    },
                    this.onConnection.bind(this)
                );

                let keysExist = false;
                try {
                    fs.accessSync(path.join(configPath, 'id', 'private.rsa'), fs.constants.F_OK);
                    fs.accessSync(path.join(configPath, 'id', 'public.rsa'), fs.constants.F_OK);
                    keysExist = true;
                } catch (error) {
                    // do nothing
                }

                if (keysExist)
                    return;

                this._logger.debug('peer', 'Creating RSA keys');
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
                            return this.error('Could not create public key');
                    });
            })
            .then(() => {
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
                            this._logger.info(`UDP socket started on ${this._utpPort}`);
                            resolve();
                        });
                        this._logger.info('Initiating UDP socket...');
                        this.utp.bind(this._utpPort, () => {
                            // let stale connections receive their RST
                            setTimeout(this.utp.listen.bind(this.utp), 3000);
                        });
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

        this._closing = true;

        if (this._timeoutTimer) {
            clearInterval(this._timeoutTimer);
            this._timeoutTimer = null;
        }

        return new Promise((resolve, reject) => {
            try {
                for (let [ id, session ] of this.sessions) {
                    session.socket.setTimeout(this.constructor.closeTimeout);
                    session.wrapper.detach();
                }
                this.utp.close(() => { this._logger.info(`Peers dropped`, () => { resolve(); }); });
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
                internal: [],
                external: null,
                trying: null,
                successful: false,
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
        for (let id of connection.sessionIds)
            this.end(id);

        this._tracker.sendStatus(tracker, name, false);
        this.connections.delete(fullName);
    }

    /**
     * Connect to server
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} type                     'internal' or 'external'
     */
    connect(tracker, name, type) {
        if (this._closing)
            return;

        let fullName = tracker + '#' + name;
        let connection = this.connections.get(fullName);
        if (!connection || connection.server || connection.trying)
            return;

        if (type === 'internal' && !connection.internal.length)
            return;
        if (type === 'external' && !connection.external)
            return;

        connection.trying = type;

        let doConnect = (address, port) => {
            try {
                this._logger.info(`Initiating connection to ${type} address of ${fullName} (${address}:${port})`);
                let session, socket = this.utp.connect(
                    port,
                    address,
                    () => {
                        for (let id of connection.sessionIds) {
                            let existing = this.sessions.get(id);
                            if (existing && existing.connected) {
                                this.end(session.id);
                                return;
                            }
                        }

                        this._logger.info(`Connected to ${type} address of ${fullName} (${address}:${port})`);

                        session.connected = true;
                        session.socket.setTimeout(this.constructor.pongTimeout);

                        for (let id of connection.sessionIds) {
                            if (id !== session.id)
                                this.end(id);
                        }

                        let timeout = this._timeouts.get(session.id);
                        if (timeout) {
                            timeout.send = Date.now() + this.constructor.pingTimeout;
                            timeout.establish = Date.now() + this.constructor.establishTimeout;
                        }

                        this.emit('connect', session.id);
                    }
                );

                session = this.createSession(fullName, socket);
                socket.setTimeout(this.constructor.connectTimeout);
                connection.sessionIds.add(session.id);
            } catch (error) {
                this._logger.error(new NError(error, `Peer.connect(): ${fullName}`));
            }
        };

        if (type === 'internal') {
            for (let host of connection.internal)
                doConnect(host.address, host.port);
        } else if (type === 'external') {
            let address = connection.external.address;
            let port = connection.external.port;
            this._logger.debug('peer', `Punching ${fullName}: ${address}:${port}`);
            this.utp.punch(this.constructor.punchingAttempts, port, address, success => {
                if (success)
                    return doConnect(address, port);

                this._logger.info(`Could not open NAT of ${name} (${address}:${port})`);
                connection.trying = null;
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
        session.socket.on('timeout', () => {
            this.onTimeout(sessionId);
        });

        session.wrapper.on(
            'receive',
            data => {
                if (!this.onMessage(sessionId, data))
                    this.end(sessionId);
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

        this._timeouts.set(sessionId, {});

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
                this.end(sessionId);
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
     * End session
     * @param {string} sessionId                Session ID
     */
    end(sessionId) {
        let session = this.sessions.get(sessionId);
        if (!session)
            return;

        session.socket.setTimeout(this.constructor.closeTimeout);
        session.socket.end();
        session.wrapper.detach();
    }

    /**
     * Incoming connection handler
     * @param {object} socket                   Client socket
     */
    onConnection(socket) {
        this._logger.debug('peer', `Incoming daemon socket from ${socket.address().address}:${socket.address().port}#${socket.id}`);
        let session = this.createSession(null, socket);

        session.connected = true;
        session.socket.setTimeout(this.constructor.pongTimeout);

        let timeout = this._timeouts.get(session.id);
        if (timeout) {
            timeout.send = Date.now() + this.constructor.pingTimeout;
            timeout.establish = Date.now() + this.constructor.establishTimeout;
        }

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

        if (session.established)
            this._logger.info(`Peer ${(cryptSession && cryptSession.peerName) || 'unknown'} of ${session.name || 'unknown'} disconnected (${session.socket.address().address}:${session.socket.address().port})`);
        else
            this._logger.debug('peer', `Dropped socket for ${session.name || 'unknown'} from ${session.socket.address().address}:${session.socket.address().port}#${session.socket.id}`);

        session.socket.destroy();
        session.wrapper.destroy();

        this.sessions.delete(sessionId);

        if (!session.name)
            return;

        let [ tracker, connectionName ] = session.name.split('#');

        if (session.established) {
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

        if (session.established)
            this._front.close(connection.name, sessionId);

        if (connection.server) {
            if (session.established)
                this._tracker.sendStatus(tracker, connectionName);
        } else if (!this._closing && connection.sessionIds.size === 0) {
            let reconnect;
            if (connection.trying === 'internal')
                reconnect = connection.successful ? 'internal' : 'external';
            else if (connection.trying === 'external' && connection.successful)
                reconnect = 'external';

            connection.trying = null;
            connection.successful = false;

            if (reconnect === 'external') {
                setTimeout(
                    () => {
                        if (!connection.trying)
                            this._tracker.sendStatus(tracker, connectionName);
                    },
                    this.constructor.addressTimeout
                );
                this._tracker.sendPunchRequest(tracker, connectionName);
            } else if (reconnect === 'internal') {
                this.connect(tracker, connectionName, 'internal');
            } else {
                setTimeout(
                    () => {
                        if (!connection.trying)
                            this._tracker.sendStatus(tracker, connectionName);
                    },
                    this.constructor.failureTimeout
                );
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