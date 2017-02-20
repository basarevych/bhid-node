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
        name = tracker + '#' + name;
        debug(`Starting ${name}`);
        try {
            let connection = {
                name: name,
                tracker: tracker,
                peerId: null,
                server: true,
                registering: false,
                registered: false,
                connectAddress: connectAddress,
                connectPort: connectPort,
                encrypted: encrypted,
                fixed: fixed,
                peers: peers,
                utp: null,
                clients: new Map(),
            };
            this.connections.set(name, connection);

            new Promise((resolveBind, rejectBind) => {
                    debug('Initiating server socket');
                    connection.utp = utp.createServer(socket => { this.onConnection(name, socket); });
                    connection.utp.once('error', error => { rejectBind(error); });
                    connection.utp.bind();
                    connection.utp.listen(() => { resolveBind(); })
                })
                .then(() => {
                    debug(`Network server for ${name} started`);
                    this._tracker.sendStatus(
                        tracker,
                        name.split('#')[1],
                        0,
                        connection.utp.getUdpSocket().address().address,
                        connection.utp.getUdpSocket().address().port
                    );
                })
                .catch(error => {
                    this.connections.delete(name);
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
    openClient(tracker, name, { listenAddress, listenPort, encrypted, peers }) {
        name = tracker + '#' + name;
        debug(`Starting ${name}`);
        let connection = {
            name: name,
            tracker: tracker,
            peerId: null,
            server: false,
            registering: false,
            registered: false,
            listenAddress: listenAddress,
            listenPort: listenPort,
            encrypted: encrypted,
            fixed: true,
            peers: peers,
            utp: null,
            sessionId: null,
            socket: null,
            wrapper: new SocketWrapper(),
            internal: {
                address: null,
                port: null,
                connecting: false,
                connected: false,
                rejected: false,
            },
            external: {
                address: null,
                port: null,
                punchingTimer: null,
                connecting: false,
                connected: false,
                rejected: false,
            },
            verified: false,
            accepted: false,
        };
        this.connections.set(name, connection);
        this._tracker.sendStatus(tracker, name.split('#')[1], 0);
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
        connection.closing = true;
        if (connection.server) {
            for (let id of connection.clients.keys())
                this.onClose(name, id);
        } else {
            this.onClose(name, connection.sessionId);
        }

        this.connections.delete(name);
        if (connection.utp)
            connection.utp.close();
    }

    /**
     * Connect to server
     * @param {string} name             Connection name
     * @param {string} type             'internal' or 'external'
     * @param {string} address          Server address
     * @param {string} port             Server port
     */
    connect(name, type, address, port) {
        let connection = this.connections.get(name);
        if (!connection || connection.server || connection.internal.connecting || connection.external.connecting)
            return;

        connection[type].address = address;
        connection[type].port = port;

        if (type == 'external' && connection[type].punchingTimer) {
            clearTimeout(connection[type].punchingTimer);
            connection[type].punchingTimer = null;
        }

        connection.verified = false;
        connection.accepted = false;

        connection[type].connecting = true;
        connection[type].connected = false;
        connection[type].rejected = false;

        let doConnect = () => {
            try {
                this._logger.info(`Initiating ${type} connection to ${name} (${address}:${port})`);
                connection.sessionId = this._crypter.create(name);

                connection.socket = connection.utp.connect(
                    port,
                    address,
                    () => {
                        let newCon = this.connections.get(name);
                        if (!newCon || newCon.sessionId !== connection.sessionId) {
                            connection.socket.end();
                            return;
                        }

                        connection.wrapper.removeAllListeners();
                        connection.wrapper.attach(connection.socket);

                        connection.wrapper.on(
                            'receive',
                            data => {
                                if (!this.onMessage(name, connection.sessionId, data)) {
                                    connection.socket.end();
                                    connection.wrapper.detach();
                                }
                            }
                        );
                        connection.wrapper.on(
                            'read',
                            data => {
                                let timeout = this._timeouts.get(connection.sessionId);
                                if (timeout)
                                    timeout.receive = Date.now() + this.constructor.pongTimeout;
                            }
                        );
                        connection.wrapper.on(
                            'flush',
                            data => {
                                let timeout = this._timeouts.get(connection.sessionId);
                                if (timeout)
                                    timeout.send = Date.now() + this.constructor.pingTimeout;
                            }
                        );

                        this._logger.info(`Connected to ${type} address of ${name}`);
                        this._timeouts.set(
                            connection.sessionId,
                            {
                                send: Date.now() + this.constructor.pingTimeout,
                                receive: Date.now() + this.constructor.pongTimeout,
                                name: name,
                            }
                        );
                        connection[type].connected = true;

                        this.emit('connection', name, connection.sessionId);
                    }
                );
                this._timeouts.set(
                    connection.sessionId,
                    {
                        send: 0,
                        receive: Date.now() + this.constructor.connectTimeout,
                        name: name,
                    }
                );

                connection.socket.on('error', error => {
                    this.onError(name, connection.sessionId, error);
                });
                connection.socket.on('close', () => {
                    this.onClose(name, connection.sessionId);
                });
            } catch (error) {
                this._logger.error(new WError(error, `Peer.connect(): ${name}`));
            }
        };

        if (type === 'internal' && !connection.utp) {
            this._bind(name, () => { doConnect(); });
        } else if (type === 'external' && connection.utp) {
            debug(`Punching ${name}: ${address}:${port}`);
            connection.utp.punch(this.constructor.punchingAttempts, port, address, success => {
                if (success)
                    return doConnect();

                this._logger.info(`Could not open NAT of ${name}`);
                connection[type].connecting = false;
                connection.utp.close();
                connection.utp = null;
            });
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

        let wrapper, socket;
        if (connection.server) {
            let client = connection.clients.get(sessionId);
            if (client) {
                wrapper = client.wrapper;
                socket = client.socket;
            }
        } else {
            wrapper = connection.wrapper;
            socket = connection.socket;
        }
        if (!wrapper) {
            if (end === true && socket)
                socket.end();
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

        if (end === true && socket) {
            wrapper.once('flush', () => {
                wrapper.detach();
                socket.end();
            });
        }

        wrapper.send(data);
    }

    /**
     * Send inner message to a peer
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     * @param {*} data                          Message
     */
    sendInnerMessage(name, sessionId, data) {
        let connection = this.connections.get(name);
        if (!connection || !data.length)
            return;

        let info;
        if (connection.server)
            info = connection.clients.get(sessionId);
        else
            info = connection;
        if (!info)
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
        let sessionId = this._crypter.create(name);
        if (!sessionId) {
            socket.end();
            return;
        }

        let connection = this.connections.get(name);
        if (!connection) {
            socket.end();
            return;
        }

        let client = {
            sessionId: sessionId,
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
        connection.clients.set(sessionId, client);

        client.wrapper.on(
            'receive',
            data => {
                if (!this.onMessage(name, sessionId, data)) {
                    socket.end();
                    client.wrapper.detach();
                }
            }
        );
        client.wrapper.on(
            'read',
            data => {
                let timeout = this._timeouts.get(sessionId);
                if (timeout)
                    timeout.receive = Date.now() + this.constructor.pongTimeout;
            }
        );
        client.wrapper.on(
            'flush',
            data => {
                let timeout = this._timeouts.get(sessionId);
                if (timeout)
                    timeout.send = Date.now() + this.constructor.pingTimeout;
            }
        );

        socket.on('error', error => { this.onError(name, sessionId, error); });
        socket.on('close', () => { this.onClose(name, sessionId); });

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

        let session = this._crypter.sessions.get(sessionId);
        if (!session)
            return false;

        let info = connection.server ? connection.clients.get(sessionId) : connection;
        if (!info)
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

            if (!info.verified && !connection.server) {
                if (info.internal.connected)
                    info.internal.rejected = true;
                if (info.external.connected)
                    info.external.rejected = true;
            }

            return false;
        }

        try {
            debug(`Incoming message for ${name}: ${message.type}`);
            if (message.type === this.OuterMessage.Type.BYE) {
                debug(`Received BYE from ${name}`);
                return false;
            } else {
                if (!info.verified || !info.accepted) {
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
        this._front.close(name, sessionId);
        this._crypter.destroy(sessionId);

        let connection = this.connections.get(name);
        if (!connection)
            return;

        debug(`Socket for ${name} disconnected`);
        let trackedConnections = this._connectionsList.list.get(connection.tracker);
        if (trackedConnections) {
            let info = connection.server ? connection.clients.get(sessionId) : connection;
            let serverInfo = trackedConnections.serverConnections.get(connection.name.split('#')[1]);
            let clientInfo = trackedConnections.clientConnections.get(connection.name.split('#')[1]);
            if (serverInfo && serverInfo.connected > 0 && info.verified && info.accepted) {
                serverInfo.connected--;
            } else if (clientInfo && clientInfo.connected > 0 && info.verified && info.accepted) {
                clientInfo.connected--;
            }
        }

        if (connection.server) {
            let client = connection.clients.get(sessionId);
            if (client) {
                if (client.socket) {
                    if (!client.socket.destroyed)
                        client.socket.destroy();
                    client.socket = null;
                    client.wrapper.detach();
                }
                connection.clients.delete(sessionId);
            }
            let parts = name.split('#');
            this._tracker.sendStatus(parts[0], parts[1]);
        } else {
            if (connection.socket) {
                if (!connection.socket.destroyed)
                    connection.socket.destroy();
                connection.socket = null;
                connection.wrapper.detach();
            }
            connection.utp = null;
            connection.sessionId = null;
            if (connection.internal.rejected && connection.external.rejected) {
                this.connections.delete(name);
                return;
            }

            let reconnect;
            if (connection.internal.connecting) {
                if (connection.internal.connected) {
                    reconnect = connection.internal.rejected ? 'external' : 'internal';
                } else {
                    reconnect = 'external';
                }
            }

            connection.verified = false;
            connection.accepted = false;

            connection.internal.connecting = false;
            connection.internal.connected = false;
            connection.internal.rejected = false;

            connection.external.connecting = false;
            connection.external.connected = false;
            connection.external.rejected = false;

            let parts = connection.name.split('#');
            if (connection.closing) {
                this._tracker.sendStatus(parts[0], parts[1]);
                return;
            }

            if (reconnect === 'external') {
                connection.external.punchingTimer = setTimeout(
                    () => {
                        connection.external.punchingTimer = null;
                        let parts = name.split('#');
                        this._tracker.sendStatus(parts[0], parts[1]);
                    },
                    this.constructor.connectTimeout
                );
                this._tracker.sendPunchRequest(parts[0], parts[1]);
            } else if (reconnect === 'internal') {
                this.connect(connection.name, 'internal', connection.internal.address, connection.internal.port);
            } else {
                this._logger.info(`Connection to ${name} failed`);
                setTimeout(() => {
                    this._tracker.sendStatus(parts[0], parts[1]);
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
        let connection = this.connections.get(name);
        if (!connection)
            return;

        if (connection.server) {
            let client = connection.clients.get(sessionId);
            if (client && client.socket) {
                client.socket.destroy();
                client.wrapper.detach();
            }
        } else {
            if (connection.socket) {
                connection.socket.destroy();
                connection.wrapper.detach();
            }
        }
    }

    /**
     * Bind UTP socket and run callback
     * @param {string} name                     Connection name
     * @param {function} cb                     Callback
     */
    _bind(name, cb) {
        let connection = this.connections.get(name);
        if (!connection || connection.utp)
            return;

        connection.utp = utp.createClient();
        connection.utp.once('error', error => {
            connection.utp = null;
            setTimeout(() => {
                this._bind(name, cb);
            }, 1000);
        });
        connection.utp.once('bound', () => {
            cb();
        });

        connection.utp.bind();
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