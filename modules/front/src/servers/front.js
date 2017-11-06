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

        this.connections = new Map();               // name => FrontServerConnection(name) or FrontClientConnection(name)

        this._name = null;
        this._closing = false;
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
     * @type {number}
     */
    static get bindPause() {
        return 3 * 1000; // ms
    }

    /**
     * Initialize the server
     * @param {string} name                     Config section name
     * @return {Promise}
     */
    async init(name) {
        this._name = name;
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
            this._logger.debug('front', 'Starting the server');
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
            await new Promise((resolve, reject) => {
                try {
                    let counter = 0;
                    let done = () => {
                        if (--counter <= 0)
                            this._logger.info(`Front is closed`, resolve);
                    };

                    for (let [name, connection] of this.connections) {
                        if (connection.server) {
                            for (let [id, target] of connection.targets) {
                                if (target.connected) {
                                    counter++;
                                    target.socket.once('close', done);
                                    target.socket.end();
                                } else {
                                    let [tracker, connName] = name.split('#');
                                    this.onClose(tracker, connName, id);
                                }
                            }
                        } else {
                            for (let [id, client] of connection.clients) {
                                if (client.connected) {
                                    counter++;
                                    client.socket.once('close', done);
                                    client.socket.end();
                                } else {
                                    let [tracker, connName] = name.split('#');
                                    this.onClose(tracker, connName, id);
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
        } catch (error) {
            return this._app.exit(
                this._app.constructor.fatalExitCode,
                error.messages || error.message
            );
        }
    }

    /**
     * Get ready to forward to actual server
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} address                  Server address
     * @param {string} port                     Server port
     */
    openServer(tracker, name, tunnelId, address, port) {
        let fullName = tracker + '#' + name;
        let info = this._peer.connections.get(fullName);
        if (!info)
            return;

        this._logger.debug('front', `Opening server front for ${fullName}`);
        let connection = this.connections.get(fullName);
        if (connection && !connection.server) {
            this.close(tracker, name);
            connection = null;
        }

        if (!connection) {
            connection = this._app.get('entities.frontServerConnection', fullName);
            connection.address = address;
            connection.port = port;
            connection.encrypted = info.encrypted;
            this.connections.set(fullName, connection);
        } else {
            connection.address = address;
            connection.port = port;
        }
    }

    /**
     * Get ready to accept clients
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} address                  Listen address
     * @param {string} port                     Listen port
     */
    openClient(tracker, name, tunnelId, address, port) {
        let fullName = tracker + '#' + name;
        let info = this._peer.connections.get(fullName);
        if (!info)
            return;

        this._logger.debug('front', `Opening client front for ${fullName}`);
        let connection = this.connections.get(fullName);
        if (connection && connection.server) {
            this.close(tracker, name);
            connection = null;
        }
        if (connection)
            return;

        connection = this._app.get('entities.frontClientConnection', fullName);
        connection.address = address;
        connection.port = port;
        connection.encrypted = info.encrypted;
        this.connections.set(fullName, connection);

        let bind, strAddress, onListening, onError;
        onListening = () => {
            let newCon = this.connections.get(fullName);
            if (!newCon || newCon !== connection)
                return;

            connection.address = connection.tcp.address().address;
            connection.port = connection.tcp.address().port.toString();

            let info = this._peer.connections.get(fullName);
            if (info) {
                info.listenAddress = connection.address;
                info.listenPort = connection.port;
            }

            this._connectionsList.updatePort(tracker, name, connection.port);

            this._logger.info(`Ready for connections for ${fullName} on ${strAddress}`);
            connection.tcp.removeListener('error', onError);
        };
        onError = error => {
            if (error.syscall !== 'listen')
                return this._logger.error(new NError(error, 'Front.openClient()'));

            switch (error.code) {
                case 'EACCES':
                    this._logger.error(`${fullName}: Could not bind to ${strAddress}`);
                    setTimeout(() => { bind(); }, this.constructor.bindPause);
                    break;
                case 'EADDRINUSE':
                    this._logger.error(`${fullName}: ${strAddress} is already in use`);
                    setTimeout(() => { bind(); }, this.constructor.bindPause);
                    break;
                default:
                    this._logger.error(new NError(error, 'Front.openClient()'));
            }
        };

        let listenArgs = [];
        if (!port || port === '*') {
            listenArgs.push(0);
            strAddress = '*';
        } else if (port[0] === '/') {
            listenArgs.push(port);
            strAddress = port;
        } else {
            listenArgs.push(parseInt(port));
            strAddress = port;
        }
        if (strAddress[0] !== '/') {
            if (address && address !== '*') {
                listenArgs.push(address);
                strAddress = address + ':' + strAddress;
            } else {
                strAddress = '*:' + strAddress;
            }
        }
        listenArgs.push(onListening);

        bind = () => {
            let newCon = this.connections.get(fullName);
            if (!newCon || newCon !== connection)
                return;

            connection.tcp = net.createServer(socket => { this.onConnection(tracker, name, tunnelId, socket); });
            connection.tcp.once('error', onError);
            connection.tcp.listen.apply(connection.tcp, listenArgs);
        };
        bind();
    }

    /**
     * Connect to server
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} id                       Session ID
     */
    connect(tracker, name, tunnelId, id) {
        if (this._closing)
            return;

        let fullName = tracker + '#' + name;
        this._logger.debug('front', `Connecting front to ${fullName}`);

        let connection = this.connections.get(fullName);
        if (!connection || !connection.server)
            return;

        let info = connection.targets.get(id);
        if (!info) {
            info = this._app.get('entities.frontServerConnectionTarget', id);
            info.tunnelId = tunnelId;
            info.socket = null;
            info.buffer = [];
            info.connected = false;
            connection.targets.set(id, info);
        }

        if (info.socket) {
            try {
                let message = this._peer.InnerMessage.create({
                    type: this._peer.InnerMessage.Type.CLOSE,
                    id: id,
                });
                let buffer = this._peer.InnerMessage.encode(message).finish();
                this._logger.debug('front', `Sending disconnect to ${fullName} because already connected`);
                this._peer.sendInnerMessage(
                    tunnelId,
                    connection.encrypted,
                    buffer
                );
            } catch (error) {
                this._logger.error(new NError(error, `Front.connect(): ${fullName}`));
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
                this._logger.debug('front', `Connected front to ${fullName}`);
                info.connected = true;
                info.socket.setTimeout(0);

                let data;
                while ((data = info.buffer.shift()))
                    info.socket.write(data);
            }
        );

        info.socket.on('data', data => { if (!this.onData(tracker, name, id, data)) { info.socket.end(); info.connected = false; } });
        info.socket.on('error', error => { this.onError(tracker, name, id, error); });
        info.socket.on('timeout', () => { this.onTimeout(tracker, name, id); });
        info.socket.on('close', () => { this.onClose(tracker, name, id); });
    }

    /**
     * Relay data to server or client
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} id                       Session ID
     * @param {Buffer} data                     Message
     */
    relay(tracker, name, tunnelId, id, data) {
        let fullName = tracker + '#' + name;
        this._logger.debug('front', `Relaying ${data.length} bytes to ${fullName}`);

        let connection = this.connections.get(fullName);
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
                this._logger.debug('front', `Sending disconnect to ${fullName} because not connected`);
                this._peer.sendInnerMessage(
                    tunnelId,
                    connection.encrypted,
                    buffer
                );
            } catch (error) {
                this._logger.error(new NError(error, `Front.relay(): ${fullName}`));
            }
            return;
        }

        info.buffer.push(data);

        if (info.connected) {
            while ((data = info.buffer.shift()))
                info.socket.write(data);
        }
    }

    /**
     * Disconnect from server or client
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} id                       Session ID
     */
    disconnect(tracker, name, tunnelId, id) {
        let fullName = tracker + '#' + name;
        this._logger.debug('front', `Disconnecting front to ${fullName}`);

        let connection = this.connections.get(fullName);
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
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} [tunnelId]               Tunnel ID
     */
    close(tracker, name, tunnelId) {
        let fullName = tracker + '#' + name;
        let connection = this.connections.get(fullName);
        if (!connection)
            return;

        this._logger.debug('front', `Closing front for ${fullName}`);
        if (connection.server) {
            for (let [ id, info ] of connection.targets) {
                if ((!tunnelId || info.tunnelId === tunnelId)) {
                    if (info.connected) {
                        info.socket.end();
                        info.connected = false;
                    } else {
                        this.onClose(tracker, name, id);
                    }
                }
            }
            if (!tunnelId)
                this.connections.delete(fullName);
        } else {
            for (let [ id, info ] of connection.clients) {
                if (info.connected) {
                    info.socket.end();
                    info.connected = false;
                } else {
                    this.onClose(tracker, name, id);
                }
            }
            connection.tcp.close();
            connection.tcp = null;
            this._logger.info(`No more connections for ${fullName} on ${connection.address}:${connection.port}`);
            this.connections.delete(fullName);
        }
    }

    /**
     * Handle incoming connection
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} tunnelId                 Tunnel ID
     * @param {object} socket                   New connection
     */
    onConnection(tracker, name, tunnelId, socket) {
        let fullName = tracker + '#' + name;
        let connection = this.connections.get(fullName);
        if (!connection) {
            socket.end();
            return;
        }

        this._logger.debug('front', `New front connection for ${fullName}`);

        let id = uuid.v1();
        let info = this._app.get('entities.frontClientConnectionClient', id);
        info.tunnelId = tunnelId;
        info.socket = socket;
        info.buffer = [];
        info.connected = true;
        connection.clients.set(id, info);

        socket.on('data', data => { if (!this.onData(tracker, name, id, data)) { socket.end(); info.connected = false; } });
        socket.on('error', error => { this.onError(tracker, name, id, error); });
        socket.on('close', () => { this.onClose(tracker, name, id); });

        try {
            let message = this._peer.InnerMessage.create({
                type: this._peer.InnerMessage.Type.OPEN,
                id: id,
            });
            let buffer = this._peer.InnerMessage.encode(message).finish();
            this._logger.debug('front', `Sending connect to ${fullName}`);
            this._peer.sendInnerMessage(
                tunnelId,
                connection.encrypted,
                buffer
            );
        } catch (error) {
            this._logger.error(new NError(error, `Front.onConnection(): ${fullName}`));
        }
    }

    /**
     * Socket data handler
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} sessionId                Session ID
     * @param {Buffer} data                     Message
     */
    onData(tracker, name, sessionId, data) {
        let fullName = tracker + '#' + name;
        this._logger.debug('front', `Relaying ${data.length} bytes from ${fullName}`);

        let connection = this.connections.get(fullName);
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
            this._logger.debug('front', `Sending data to ${fullName}`);
            this._peer.sendInnerMessage(
                info.tunnelId,
                connection.encrypted,
                buffer
            );
        } catch (error) {
            this._logger.error(new NError(error, `Front.onData(): ${fullName}`));
        }

        return true;
    }

    /**
     * Socket error handler
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} sessionId                Session ID
     * @param {Error} error                     Error
     */
    onError(tracker, name, sessionId, error) {
        let fullName = tracker + '#' + name;
        if (error.code !== 'ECONNRESET')
            this._logger.error(`Front ${fullName} socket error: ${error.messages || error.message}`);
    }

    /**
     * Socket timeout handler
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} sessionId                Session ID
     */
    onTimeout(tracker, name, sessionId) {
        let fullName = tracker + '#' + name;
        this._logger.debug('front', `Socket timeout for ${fullName}`);
        this.onClose(tracker, name, sessionId);
    }

    /**
     * Socket termination handler
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Connection name on tracker
     * @param {string} sessionId                Session ID
     */
    onClose(tracker, name, sessionId) {
        let fullName = tracker + '#' + name;
        let connection = this.connections.get(fullName);
        if (!connection)
            return;

        this._logger.debug('front', `Socket for ${fullName} disconnected`);

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
            this._logger.debug('front', `Sending disconnect to ${fullName} because app has closed the connection`);
            this._peer.sendInnerMessage(
                info.tunnelId,
                connection.encrypted,
                buffer
            );
        } catch (error) {
            this._logger.error(new NError(error, `Front.onClose(): ${fullName}`));
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
