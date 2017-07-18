/**
 * Front connections server and client
 * @module servers/front
 */
const net = require('net');
const uuid = require('uuid');
const EventEmitter = require('events');
const NError = require('nerror');

/**
 * Server responsible for connections to and from consumers
 */
class Front extends EventEmitter {
    /**
     * Create the service
     * @param {App} app                             Application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, connectionsList) {
        super();

        this.connections = new Map();               /* name => {
                                                            server: true, // connection to a server app
                                                            name: 'tracker#user@dom/path',
                                                            address: string, // connect to
                                                            port: string,
                                                            targets: (Map) id => {
                                                                id: session id (generated on other side),
                                                                tunnelId: session id of Peer server,
                                                                socket: actual tcp socket,
                                                                buffer: array,
                                                                connected: boolean,
                                                            },
                                                       } or {
                                                            server: false, // connection from a client app
                                                            name: 'tracker#user@dom/path',
                                                            address: string, // listen on
                                                            port: string,
                                                            tcp: socket server,
                                                            clients: (Map) id => {
                                                                id: session id (generated uuid on connect),
                                                                tunnelId: session id of Peer server,
                                                                socket: actual tcp socket,
                                                                buffer: array,
                                                                connected: boolean,
                                                            },
                                                       }
                                                    */

        this._name = null;
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._connectionsList = connectionsList;
    }

    /**
     * Service name is 'servers.front'
     * @type {string}
     */
    static get provides() {
        return 'servers.front';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'connectionsList' ];
    }

    /**
     * Client app connect timeout
     * @type {number}
     */
    static get connectTimeout() {
        return 5 * 1000; // ms
    }

    /**
     * Bind retry pause
     */
    static get bindPause() {
        return 3 * 1000; // ms
    }

    /**
     * Initialize the server
     * @param {string} name                     Config section name
     * @return {Promise}
     */
    init(name) {
        this._name = name;
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
                        if (result === null || typeof result !== 'object' || typeof result.then !== 'function')
                            throw new Error(`Module '${curName}' register() did not return a Promise`);
                        return result;
                    });
                },
                Promise.resolve()
            )
            .then(() => {
                this._logger.debug('front', 'Starting the server');
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

        return new Promise((resolve, reject) => {
            let counter = 0;
            let done = () => {
                if (--counter <= 0)
                    this._logger.info(`Front is closed`, () => { resolve(); });
            };
            try {
                for (let [ name, connection ] of this.connections) {
                    if (connection.server) {
                        for (let [ id, target ] of connection.targets) {
                            if (target.connected) {
                                counter++;
                                target.socket.once('close', done);
                                target.socket.end();
                            } else {
                                this.onClose(name, id);
                            }
                        }
                    } else {
                        for (let [ id, client ] of connection.clients) {
                            if (client.connected) {
                                counter++;
                                client.socket.once('close', done);
                                client.socket.end();
                            } else {
                                this.onClose(name, id);
                            }
                        }
                        connection.tcp.close();
                    }
                }
                if (!counter)
                    done();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Get ready to forward to actual server
     * @param {string} name                     Connection full name
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} address                  Server address
     * @param {string} port                     Server port
     */
    openServer(name, tunnelId, address, port) {
        this._logger.debug('front', `Opening front for ${name}`);
        let connection = this.connections.get(name);
        if (connection && !connection.server) {
            this.close(name);
            this.connections.delete(name);
            connection = null;
        }

        if (!connection) {
            connection = {
                name: name,
                server: true,
                address: address,
                port: port,
                targets: new Map(),
            };
            this.connections.set(name, connection);
        } else {
            connection.address = address;
            connection.port = port;
        }
    }

    /**
     * Get ready to accept clients
     * @param {string} name                     Connection full name
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} address                  Listen address
     * @param {string} port                     Listen port
     */
    openClient(name, tunnelId, address, port) {
        let connection = this.connections.get(name);
        if (connection && connection.server) {
            this.close(name);
            this.connections.delete(name);
            connection = null;
        }
        if (connection)
            return;

        if (address === '*')
            address = '';
        if (port === '*')
            port = '';

        this._logger.debug('front', `Opening front for ${name}`);
        connection = {
            name: name,
            server: false,
            address: address,
            port: port,
            tcp: null,
            clients: new Map(),
        };
        this.connections.set(name, connection);

        connection.tcp = net.createServer(socket => { this.onConnection(name, tunnelId, socket); });
        let bind;
        let onError = error => {
            if (error.syscall !== 'listen')
                return this._logger.error(new NError(error, 'Front.openClient()'));

            switch (error.code) {
                case 'EACCES':
                    this._logger.error(`${name}: Could not bind to ${address}:${port}`);
                    setTimeout(() => { bind(); }, this.constructor.bindPause);
                    break;
                case 'EADDRINUSE':
                    this._logger.error(`${name}: port ${address}:${port} is already in use`);
                    setTimeout(() => { bind(); }, this.constructor.bindPause);
                    break;
                default:
                    this._logger.error(new NError(error, 'Front.openClient()'));
            }
        };
        bind = () => {
            let newCon = this.connections.get(name);
            if (!newCon || newCon !== connection)
                return;

            connection.tcp.once('error', onError);

            let onListening = () => {
                let newCon = this.connections.get(name);
                if (!newCon || newCon !== connection)
                    return;

                connection.address = connection.tcp.address().address;
                connection.port = connection.tcp.address().port.toString();

                let info = this._peer.connections.get(name);
                if (info) {
                    info.listenAddress = connection.address;
                    info.listenPort = connection.port;
                }

                let [ tracker, connName ] = connection.name.split('#');
                this._connectionsList.updatePort(tracker, connName, connection.port);

                this._logger.info(`Ready for connections for ${name} on ${connection.address}:${connection.port}`);
                connection.tcp.removeListener('error', onError);
            };

            let listenArgs = [];
            listenArgs.push(port.length ? port : 0);
            if (address.length)
                listenArgs.push(address);
            listenArgs.push(onListening);

            connection.tcp.listen.apply(connection.tcp, listenArgs);
        };
        bind();
    }

    /**
     * Connect to server
     * @param {string} name                     Connection full name
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} id                       Session ID
     */
    connect(name, tunnelId, id) {
        this._logger.debug('front', `Connecting front to ${name}`);

        let connection = this.connections.get(name);
        if (!connection || !connection.server)
            return;

        let info = connection.targets.get(id);
        if (!info) {
            info = {
                id: id,
                tunnelId: tunnelId,
                socket: null,
                buffer: [],
                connected: false,
            };
            connection.targets.set(id, info);
        }

        if (info.socket) {
            try {
                let message = this._peer.InnerMessage.create({
                    type: this._peer.InnerMessage.Type.CLOSE,
                    id: id,
                });
                let buffer = this._peer.InnerMessage.encode(message).finish();
                this._logger.debug('front', `Sending disconnect to ${name} because already connected`);
                this._peer.sendInnerMessage(
                    name,
                    tunnelId,
                    buffer
                );
            } catch (error) {
                this._logger.error(new NError(error, `Front.connect(): ${name}`));
            }
            return;
        }

        let options = {
            host: connection.address,
            port: connection.port,
            timeout: this.constructor.connectTimeout,
        };
        info.socket = net.connect(
            options,
            () => {
                this._logger.debug('front', `Connected front to ${name}`);
                info.connected = true;
                info.socket.setTimeout(0);

                let data;
                while (!!(data = info.buffer.shift()))
                    info.socket.write(data);
            }
        );

        info.socket.on('data', data => { if (!this.onData(name, id, data)) { info.socket.end(); info.connected = false; } });
        info.socket.on('error', error => { this.onError(name, id, error); });
        info.socket.on('timeout', () => { this.onTimeout(name, id); });
        info.socket.on('close', () => { this.onClose(name, id); });
    }

    /**
     * Relay data to server or client
     * @param {string} name                     Connection full name
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} id                       Session ID
     * @param {Buffer} data                     Message
     */
    relay(name, tunnelId, id, data) {
        this._logger.debug('front', `Relaying ${data.length} bytes to ${name}`);

        let connection = this.connections.get(name);
        if (!connection)
            return;

        let info;
        if (connection.server)
            info = connection.targets.get(id);
        else
            info = connection.clients.get(id);

        if (!info || info.tunnelId !== tunnelId) {
            try {
                let message = this._peer.InnerMessage.create({
                    type: this._peer.InnerMessage.Type.CLOSE,
                    id: id,
                });
                let buffer = this._peer.InnerMessage.encode(message).finish();
                this._logger.debug('front', `Sending disconnect to ${name} because not connected`);
                this._peer.sendInnerMessage(
                    name,
                    tunnelId,
                    buffer
                );
            } catch (error) {
                this._logger.error(new NError(error, `Front.relay(): ${name}`));
            }
            return;
        }

        info.buffer.push(data);

        if (info.connected) {
            while (!!(data = info.buffer.shift()))
                info.socket.write(data);
        }
    }

    /**
     * Disconnect from server or client
     * @param {string} name                     Connection full name
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} id                       Session ID
     */
    disconnect(name, tunnelId, id) {
        this._logger.debug('front', `Disconnecting front to ${name}`);

        let connection = this.connections.get(name);
        if (!connection)
            return;

        let info;
        if (connection.server)
            info = connection.targets.get(id);
        else
            info = connection.clients.get(id);

        if (!info || info.tunnelId !== tunnelId)
            return;

        info.socket.end();
        info.connected = false;
    }

    /**
     * Close server or client front
     * @param {string} name                     Connection full name
     * @param {string} [tunnelId]               Tunnel ID
     */
    close(name, tunnelId) {
        let connection = this.connections.get(name);
        if (!connection)
            return;

        this._logger.debug('front', `Closing front for ${name}`);
        if (connection.server) {
            for (let [ id, info ] of connection.targets) {
                if ((!tunnelId || info.tunnelId === tunnelId)) {
                    if (info.connected) {
                        info.socket.end();
                        info.connected = false;
                    } else {
                        this.onClose(name, id);
                    }
                }
            }
            if (!tunnelId)
                this.connections.delete(name);
        } else {
            for (let [ id, info ] of connection.clients) {
                if (info.connected) {
                    info.socket.end();
                    info.connected = false;
                } else {
                    this.onClose(name, id);
                }
            }
            connection.tcp.close();
            connection.tcp = null;
            this._logger.info(`No more connections for ${name} on ${connection.address}:${connection.port}`);
            this.connections.delete(name);
        }
    }

    /**
     * Handle incoming connection
     * @param {string} name                     Connection full name
     * @param {string} tunnelId                 Tunnel ID
     * @param {object} socket                   New connection
     */
    onConnection(name, tunnelId, socket) {
        let connection = this.connections.get(name);
        if (!connection) {
            socket.end();
            return;
        }

        this._logger.debug('front', `New front connection for ${name}`);

        let id = uuid.v1();
        let info = {
            id: id,
            tunnelId: tunnelId,
            socket: socket,
            buffer: [],
            connected: true,
        };
        connection.clients.set(id, info);

        socket.on('data', data => { if (!this.onData(name, id, data)) { socket.end(); info.connected = false; } });
        socket.on('error', error => { this.onError(name, id, error); });
        socket.on('close', () => { this.onClose(name, id); });

        try {
            let message = this._peer.InnerMessage.create({
                type: this._peer.InnerMessage.Type.OPEN,
                id: id,
            });
            let buffer = this._peer.InnerMessage.encode(message).finish();
            this._logger.debug('front', `Sending connect to ${name}`);
            this._peer.sendInnerMessage(
                name,
                tunnelId,
                buffer
            );
        } catch (error) {
            this._logger.error(new NError(error, `Front.onConnection(): ${name}`));
        }
    }

    /**
     * Socket data handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     * @param {Buffer} data                     Message
     */
    onData(name, sessionId, data) {
        this._logger.debug('front', `Relaying incoming message from front of ${name}`);

        let connection = this.connections.get(name);
        if (!connection)
            return false;

        let info;
        if (connection.server)
            info = connection.targets.get(sessionId);
        else
            info = connection.clients.get(sessionId);
        if (!info)
            return false;

        try {
            let message = this._peer.InnerMessage.create({
                type: this._peer.InnerMessage.Type.DATA,
                id: sessionId,
                data: data,
            });
            let buffer = this._peer.InnerMessage.encode(message).finish();
            this._logger.debug('front', `Sending data to ${name}`);
            this._peer.sendInnerMessage(
                name,
                info.tunnelId,
                buffer
            );
        } catch (error) {
            this._logger.error(new NError(error, `Front.onData(): ${name}`));
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
        if (error.code !== 'ECONNRESET')
            this._logger.error(`Front ${name} socket error: ${error.fullStack || error.stack}`);
    }

    /**
     * Socket timeout handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     */
    onTimeout(name, sessionId) {
        this._logger.debug('front', `Socket timeout for ${name}`);
        this.onClose(name, sessionId);
    }

    /**
     * Socket termination handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     */
    onClose(name, sessionId) {
        let connection = this.connections.get(name);
        if (!connection)
            return;

        this._logger.debug('front', `Socket for ${name} disconnected`);

        let info;
        if (connection.server) {
            info = connection.targets.get(sessionId);
            if (info) {
                info.socket.destroy();
                info.connected = false;
                connection.targets.delete(sessionId);
            }
        } else {
            info = connection.clients.get(sessionId);
            if (info) {
                info.socket.destroy();
                info.connected = false;
                connection.clients.delete(sessionId);
            }
        }

        if (!info)
            return;

        try {
            let message = this._peer.InnerMessage.create({
                type: this._peer.InnerMessage.Type.CLOSE,
                id: sessionId,
            });
            let buffer = this._peer.InnerMessage.encode(message).finish();
            this._logger.debug('front', `Sending disconnect to ${name} because app has closed the connection`);
            this._peer.sendInnerMessage(
                name,
                info.tunnelId,
                buffer
            );
        } catch (error) {
            this._logger.error(new NError(error, `Front.onClose(): ${name}`));
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

module.exports = Front;
