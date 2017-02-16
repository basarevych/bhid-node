/**
 * Tracker server
 * @module servers/tracker
 */
const debug = require('debug')('bhid:tracker');
const path = require('path');
const fs = require('fs');
const ini = require('ini');
const tls = require('tls');
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
     * @param {App} app                     Application
     * @param {object} config               Configuration
     * @param {Logger} logger               Logger service
     */
    constructor(app, config, logger) {
        super();

        this.servers = new Map();
        this.default = null;

        this._name = null;
        this._app = app;
        this._config = config;
        this._logger = logger;
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
        return [ 'app', 'config', 'logger' ];
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
        this._logger.setLogStream('tracker.log', this._config.get(`servers.${name}.log`));

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
                        this.RegisterDaemonRequest = this.proto.lookup('tracker.RegisterDaemonRequest');
                        this.RegisterDaemonResponse = this.proto.lookup('tracker.RegisterDaemonResponse');
                        this.CreateRequest = this.proto.lookup('tracker.CreateRequest');
                        this.CreateResponse = this.proto.lookup('tracker.CreateResponse');
                        this.DeleteRequest = this.proto.lookup('tracker.DeleteRequest');
                        this.DeleteResponse = this.proto.lookup('tracker.DeleteResponse');
                        this.ConnectRequest = this.proto.lookup('tracker.ConnectRequest');
                        this.ConnectResponse = this.proto.lookup('tracker.ConnectResponse');
                        this.DisconnectRequest = this.proto.lookup('tracker.DisconnectRequest');
                        this.DisconnectResponse = this.proto.lookup('tracker.DisconnectResponse');
                        this.Tree = this.proto.lookup('tracker.Tree');
                        this.TreeRequest = this.proto.lookup('tracker.TreeRequest');
                        this.TreeResponse = this.proto.lookup('tracker.TreeResponse');
                        this.ServerConnection = this.proto.lookup('tracker.ServerConnection');
                        this.ClientConnection = this.proto.lookup('tracker.ClientConnection');
                        this.ConnectionsList = this.proto.lookup('tracker.ConnectionsList');
                        this.ConnectionsListRequest = this.proto.lookup('tracker.ConnectionsListRequest');
                        this.ConnectionsListResponse = this.proto.lookup('tracker.ConnectionsListResponse');
                        this.Status = this.proto.lookup('tracker.Status');
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
     * Get daemon token for the tracker
     * @param {string} name                 Tracker name
     * @return {string}
     */
    getToken(name) {
        if (!name)
            name = this.default;
        let server = this.servers.get(name);
        if (!server || !server.token || !server.registered)
            return '';
        return server.token;
    }

    /**
     * Set daemon token for the tracker
     * @param {string} name         Name of the tracker
     * @param {string} token        The token
     */
    setToken(name, token) {
        if (!name)
            name = this.default;
        let server = this.servers.get(name);
        if (!server)
            return false;

        let oldToken = server.token;
        server.token = token;
        try {
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
                if (tracker == name) {
                    bhidConfig[section]['token'] = server.token;
                    debug(`Tracker ${name} token updated`);
                    break;
                }
            }

            fs.writeFileSync(path.join(configPath, 'bhid.conf'), ini.stringify(bhidConfig));
        } catch (error) {
            server.token = oldToken;
            this._logger.error(new WError(error, 'Tracker.setToken()'));
            return false;
        }

        return true;
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

        try {
            let message = this.ServerMessage.decode(data);
            if (message.type === this.ServerMessage.Type.ALIVE)
                return true;

            debug(`Tracker message ${message.type} from ${name}`);
            switch(message.type) {
                case this.ServerMessage.Type.INIT_RESPONSE:
                    this.emit('init_response', name, message);
                    break;
                case this.ServerMessage.Type.CONFIRM_RESPONSE:
                    this.emit('confirm_response', name, message);
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
                case this.ServerMessage.Type.CONNECT_RESPONSE:
                    this.emit('connect_response', name, message);
                    break;
                case this.ServerMessage.Type.DISCONNECT_RESPONSE:
                    this.emit('disconnect_response', name, message);
                    break;
                case this.ServerMessage.Type.TREE_RESPONSE:
                    this.emit('tree_response', name, message);
                    break;
                case this.ServerMessage.Type.CONNECTIONS_LIST_RESPONSE:
                    this.emit('connections_list_response', name, message);
                    break;
            }
        } catch (error) {
            this._logger.error(`Tracker protocol error: ${error.message}`);
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
}

module.exports = Tracker;