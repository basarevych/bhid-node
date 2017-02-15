/**
 * Peer communications server
 * @module servers/peer
 */
const debug = require('debug')('bhid:peer');
const uuid = require('uuid');
const utp = require('utp-punch');
const EventEmitter = require('events');
const WError = require('verror').WError;
const SocketWrapper = require('socket-wrapper');

/**
 * Server class
 */
class Peer extends EventEmitter {
    /**
     * Create the service
     * @param {App} app                     Application
     * @param {object} config               Configuration
     * @param {Logger} logger               Logger service
     * @param {Crypter} crypter             Crypter service
     */
    constructor(app, config, logger, crypter) {
        super();

        this._name = null;
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._crypter = crypter;
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
        return [ 'app', 'config', 'logger', 'crypter' ];
    }

    /**
     * Initialize the server
     * @param {string} name                     Config section name
     * @return {Promise}
     */
    init(name) {
        this._name = name;
        this._logger.setLogStream('peer.log', this._config.get(`servers.${name}.log`));
        return Promise.resolve();
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
            });
    }

    /**
     * Open server connection
     * @param {string} name                     Connection name
     * @param {object} options
     * @param {string} options.tracker          Tracker name
     * @param {string} options.connectAddress   Connect front to
     * @param {string} options.connectPort      Connect front to
     * @param {string} options.encrypted        Is encryption is required
     * @param {string} options.fixed            Is clients list is fixed
     * @param {string[]} options.peers          List of clients
     */
    openServer(name, { tracker, connectAddress, connectPort, encrypted, fixed, peers }) {
        debug(`Starting ${name}`);
        try {
            let connection = {
                name: name,
                peerId: null,
                server: true,
                tracker: tracker,
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
     * Open client connection
     * @param {string} name                     Connection name
     * @param {object} options
     * @param {string} options.tracker          Tracker name
     * @param {string} options.listenAddress    Front listen on
     * @param {string} options.listenPort       Front listen on
     * @param {string} options.encrypted        Is encryption is required
     * @param {string[]} options.peers          List of clients
     */
    openClient(name, { tracker, listenAddress, listenPort, encrypted, peers }) {
        debug(`Starting ${name}`);
        let connection = {
            name: name,
            peerId: null,
            server: false,
            tracker: tracker,
            registering: false,
            registered: false,
            listenAddress: listenAddress,
            listenPort: listenPort,
            encrypted: encrypted,
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
                verified: false,
            },
            external: {
                address: null,
                port: null,
                connecting: false,
                connected: false,
                rejected: false,
                verified: false,
            },
        };
        this.connections.set(name, connection);
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

        let doConnect = () => {
            connection[type].address = address;
            connection[type].port = port;

            connection[type].connecting = true;
            connection[type].connected = false;
            connection[type].rejected = false;
            connection[type].verified = false;

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
                        this.emit('connection', name, sessionId);
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
                connection.utp.close();
                connection.utp = null;
            });
        }
    }
}

module.exports = Peer;