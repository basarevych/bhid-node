/**
 * Front connections server and client
 * @module servers/front
 */
const debug = require('debug')('bhid:front');
const net = require('net');
const uuid = require('uuid');
const EventEmitter = require('events');
const WError = require('verror').WError;

/**
 * Server class
 */
class Front extends EventEmitter {
    /**
     * Create the service
     * @param {App} app                     Application
     * @param {object} config               Configuration
     * @param {Logger} logger               Logger service
     */
    constructor(app, config, logger) {
        super();

        this.connections = new Map();

        this._name = null;
        this._app = app;
        this._config = config;
        this._logger = logger;
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
        return [ 'app', 'config', 'logger' ];
    }

    /**
     * Client app connect timeout
     * @type {number}
     */
    static get connectTimeout() {
        return 3 * 1000; // ms
    }

    /**
     * Bind retry pause
     */
    static get bindPause() {
        return 1000; // ms
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
     * Get ready to forward to actual server
     * @param {string} name                     Connection name
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} address                  Server address
     * @param {string} port                     Server port
     */
    openServer(name, tunnelId, address, port) {
        debug(`Opening front for ${name}`);
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
     * @param {string} name                     Connection name
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

        if (address == '*')
            address = '';
        if (port == '*')
            port = '';

        this._logger.info(`DEBUG -${address}:${port}-`);

        debug(`Opening front for ${name}`);
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
                return this._logger.error(new WError(error, 'Front.openClient()'));

            switch (error.code) {
                case 'EACCES':
                    this._logger.error(`${name}: port ${address}:${port} requires elevated privileges`);
                    setTimeout(() => { bind(); }, this.constructor.bindPause);
                    break;
                case 'EADDRINUSE':
                    this._logger.error(`${name}: port ${address}:${port} is already in use`);
                    setTimeout(() => { bind(); }, this.constructor.bindPause);
                    break;
                default:
                    this._logger.error(new WError(error, 'Front.openClient()'));
            }
        };
        bind = () => {
            let newCon = this.connections.get(name);
            if (!newCon || newCon !== connection)
                return;

            connection.tcp.once('error', onError);
            connection.tcp.listen(port || undefined, address || undefined, () => {
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

                this._logger.info(`Ready for connections for ${name} on ${connection.address}:${connection.port}`)
                connection.tcp.removeListener('error', onError);
            });
        };
        bind();
    }

    /**
     * Connect to server
     * @param {string} name                     Connection name
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} id                       Session ID
     */
    connect(name, tunnelId, id) {
        debug(`Connecting front to ${name}`);

        let connection = this.connections.get(name);
        if (!connection)
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
                debug(`Sending disconnect to ${name}`);
                this._peer.sendInnerMessage(
                    name,
                    tunnelId,
                    buffer
                );
            } catch (error) {
                this._logger.error(new WError(error, `Front.connect(): ${name}`));
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
                debug(`Connected front to ${name}`);
                info.connected = true;
                info.socket.setTimeout(0);

                let data;
                while (data = info.buffer.shift())
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
     * @param {string} name                     Connection name
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} id                       Session ID
     * @param {Buffer} data                     Message
     */
    relay(name, tunnelId, id, data) {
        debug(`Relaying outgoing message to front of ${name}`);

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
                debug(`Sending disconnect to ${name}`);
                this._peer.sendInnerMessage(
                    name,
                    tunnelId,
                    buffer
                );
            } catch (error) {
                this._logger.error(new WError(error, `Front.relay(): ${name}`));
            }
            return;
        }

        info.buffer.push(data);

        if (info.connected) {
            while (data = info.buffer.shift())
                info.socket.write(data);
        }
    }

    /**
     * Disconnect from server or client
     * @param {string} name                     Connection name
     * @param {string} tunnelId                 Tunnel ID
     * @param {string} id                       Session ID
     */
    disconnect(name, tunnelId, id) {
        debug(`Disconnecting front to ${name}`);

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

        if (info.socket)
            info.socket.end();
        info.connected = false;
    }

    /**
     * Close server or client front
     * @param {string} name                     Connection name
     * @param {string} [tunnelId]               Tunnel ID
     */
    close(name, tunnelId) {
        let connection = this.connections.get(name);
        if (!connection)
            return;

        debug(`Closing front for ${name}`);
        if (connection.server) {
            for (let [ id, info ] of connection.targets) {
                if (!tunnelId || info.tunnelId === tunnelId) {
                    if (info.socket)
                        info.socket.end();
                    info.connected = false;
                }
            }
            if (!tunnelId)
                this.connections.delete(name);
        } else {
            for (let [ id, info ] of connection.clients) {
                if (info.socket)
                    info.socket.end();
                info.connected = false;
            }
            connection.tcp.close();
            connection.tcp = null;
            this._logger.info(`No more connections for ${name} on ${connection.address}:${connection.port}`)
            this.connections.delete(name);
        }
    }

    /**
     * Handle incoming connection
     * @param {string} name                     Connection name
     * @param {string} tunnelId                 Tunnel ID
     * @param {object} socket                   New connection
     */
    onConnection(name, tunnelId, socket) {
        debug(`New front connection for ${name}`);

        let connection = this.connections.get(name);
        if (!connection) {
            socket.end();
            return;
        }

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
            debug(`Sending connect to ${name}`);
            this._peer.sendInnerMessage(
                name,
                tunnelId,
                buffer
            );
        } catch (error) {
            this._logger.error(new WError(error, `Front.onConnection(): ${name}`));
        }
    }

    /**
     * Socket data handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     * @param {Buffer} data                     Message
     */
    onData(name, sessionId, data) {
        debug(`Relaying incoming message from front of ${name}`);

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
            debug(`Sending data to ${name}`);
            this._peer.sendInnerMessage(
                name,
                info.tunnelId,
                buffer
            );
        } catch (error) {
            this._logger.error(new WError(error, `Front.onData(): ${name}`));
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
            this._logger.error(`Front ${name} socket error: ${error.message}`);
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
     * Socket termination handler
     * @param {string} name                     Connection name
     * @param {string} sessionId                Session ID
     */
    onClose(name, sessionId) {
        debug(`Socket for ${name} disconnected`);

        let connection = this.connections.get(name);
        if (!connection)
            return;

        let info;
        if (connection.server) {
            info = connection.targets.get(sessionId);
            if (info) {
                if (info.socket && !info.socket.destroyed)
                    info.socket.destroy();
                info.socket = null;
                info.connected = false;
                connection.targets.delete(sessionId);
            }
        } else {
            info = connection.clients.get(sessionId);
            if (info) {
                if (info.socket && !info.socket.destroyed)
                    info.socket.destroy();
                info.socket = null;
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
            debug(`Sending disconnect to ${name}`);
            this._peer.sendInnerMessage(
                name,
                info.tunnelId,
                buffer
            );
        } catch (error) {
            this._logger.error(new WError(error, `Front.onClose(): ${name}`));
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
