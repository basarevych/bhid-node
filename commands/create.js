/**
 * Create command
 * @module commands/create
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Create {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Help} help               Help command
     */
    constructor(app, config, help) {
        this._app = app;
        this._config = config;
        this._help = help;
    }

    /**
     * Service name is 'commands.create'
     * @type {string}
     */
    static get provides() {
        return 'commands.create';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'commands.help' ];
    }

    /**
     * Run the command
     * @param {string[]} argv           Arguments
     * @return {Promise}
     */
    run(argv) {
        let args = argvParser
            .option({
                name: 'help',
                short: 'h',
                type: 'boolean',
            })
            .option({
                name: 'server',
                short: 's',
                type: 'boolean',
            })
            .option({
                name: 'client',
                short: 'c',
                type: 'boolean',
            })
            .option({
                name: 'encrypted',
                short: 'e',
                type: 'boolean',
            })
            .option({
                name: 'fixed',
                short: 'f',
                type: 'boolean',
            })
            .option({
                name: 'tracker',
                short: 't',
                type: 'string',
            })
            .option({
                name: 'socket',
                short: 'z',
                type: 'string',
            })
            .run(argv);

        if (args.targets.length < 3)
            return this._help.helpCreate(argv);

        let cpath = args.targets[1];
        let first = args.targets[2];
        let second = args.targets[3] || '';
        let server = !!args.options.server;
        let client = !!args.options.client;
        let encrypted = !!args.options.encrypted;
        let fixed = !!args.options.fixed;
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        if (server && client)
            return this.error('Daemon cannot be a server and a client of the same connection at the same time');

        let firstAddress, firstPort;
        let parts = first.split(':');
        if (parts.length === 2) {
            firstAddress = parts[0];
            firstPort = parts[1];
        } else if (parts.length === 1 && parts[0].length && parts[0][0] === '/') {
            firstAddress = '';
            firstPort = parts[0];
        } else {
            return this.error('Invalid connect address notation');
        }

        let secondAddress, secondPort;
        if (second) {
            parts = second.split(':');
            if (parts.length === 2) {
                secondAddress = parts[0];
                secondPort = parts[1];
            } else if (parts.length === 1 && parts[0].length && parts[0][0] === '/') {
                secondAddress = '';
                secondPort = parts[0];
            } else {
                return this.error('Invalid listen address notation');
            }
        } else {
            secondAddress = '';
            secondPort = '';
        }

        let token;
        try {
            token = fs.readFileSync(path.join(os.homedir(), '.bhid', 'master.token'), 'utf8').trim();
            if (!token)
                throw new Error('No token');
        } catch (error) {
            return this.error('Master token not found');
        }

        let type = this.CreateRequest.Type.NOT_CONNECTED;
        if (server)
            type = this.CreateRequest.Type.SERVER;
        else if (client)
            type = this.CreateRequest.Type.CLIENT;

        return this.init()
            .then(() => {
                this._app.debug('Sending CREATE REQUEST').catch(() => { /* do nothing */ });
                let request = this.CreateRequest.create({
                    trackerName: trackerName,
                    token: token,
                    path: cpath,
                    type: type,
                    encrypted: encrypted,
                    fixed: fixed,
                    connectAddress: firstAddress,
                    connectPort: firstPort,
                    listenAddress: secondAddress,
                    listenPort: secondPort,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.CREATE_REQUEST,
                    createRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                return this.send(buffer, sockName);
            })
            .then(data => {
                let message = this.ServerMessage.decode(data);
                if (message.type !== this.ServerMessage.Type.CREATE_RESPONSE)
                    return this.error('Invalid reply from daemon');

                switch (message.createResponse.response) {
                    case this.CreateResponse.Result.ACCEPTED:
                        return this._app.info(
                                'Server token: ' + message.createResponse.serverToken + '\n' +
                                'Client token: ' + message.createResponse.clientToken + '\n'
                            )
                            .then(() => {
                                if (type !== this.CreateRequest.Type.NOT_CONNECTED)
                                    return this._app.info('This daemon is configured as ' + (client ? 'client' : 'server'));
                            })
                            .then(() => {
                                if (type !== this.CreateRequest.Type.NOT_CONNECTED)
                                    return this.updateConnections(trackerName, cpath, message.createResponse.updates, sockName);
                            });
                    case this.CreateResponse.Result.REJECTED:
                        return this.error('Request rejected');
                    case this.CreateResponse.Result.INVALID_PATH:
                        return this.error('Invalid path');
                    case this.CreateResponse.Result.PATH_EXISTS:
                        return this.error('Path exists');
                    case this.CreateResponse.Result.TIMEOUT:
                        return this.error('No response from the tracker');
                    case this.CreateResponse.Result.NO_TRACKER:
                        return this.error('Not connected to the tracker');
                    case this.CreateResponse.Result.NOT_REGISTERED:
                        return this.error('Not registered with the tracker');
                    default:
                        return this.error('Unsupported response from daemon');
                }
            })
            .then(() => {
                process.exit(0);
            })
            .catch(error => {
                return this.error(error);
            });
    }

    /**
     * Load the connection
     * @param {string} trackerName                      Name of the tracker
     * @param {string} acceptPath                       Check path of the list items
     * @param {object} [list]                           List of updated connections
     * @param {string} [sockName]                       Socket name
     * @return {Promise}
     */
    updateConnections(trackerName, acceptPath, list, sockName) {
        if (!list)
            return Promise.resolve();

        return Promise.resolve()
            .then(() => {
                if (!this.proto)
                    return this.init();
            })
            .then(() => {
                let request = this.UpdateConnectionsRequest.create({
                    trackerName: trackerName,
                    list: list,
                    path: acceptPath,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.UPDATE_CONNECTIONS_REQUEST,
                    updateConnectionsRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                return this.send(buffer, sockName)
            })
            .then(data => {
                let message = this.ServerMessage.decode(data);
                if (message.type !== this.ServerMessage.Type.UPDATE_CONNECTIONS_RESPONSE)
                    return this.error('Invalid reply from daemon');

                switch (message.updateConnectionsResponse.response) {
                    case this.UpdateConnectionsResponse.Result.ACCEPTED:
                        return;
                    case this.UpdateConnectionsResponse.Result.REJECTED:
                        return this.error('Could not start the connection');
                    case this.UpdateConnectionsResponse.Result.NO_TRACKER:
                        return this.error('Not connected to the tracker');
                    case this.UpdateConnectionsResponse.Result.NOT_REGISTERED:
                        return this.error('Not registered with the tracker');
                    default:
                        return this.error('Unsupported response from daemon');
                }
            });
    }

    /**
     * Send request and return response
     * @param {Buffer} request
     * @param {string} [sockName]
     * @return {Promise}
     */
    send(request, sockName) {
        return new Promise((resolve, reject) => {
            let sock;
            if (sockName && sockName[0] === '/')
                sock = sockName;
            else
                sock = path.join('/var', 'run', 'bhid', `daemon${sockName ? '.' + sockName : ''}.sock`);

            let onError = error => {
                this.error(`Could not connect to daemon: ${error.message}`);
            };

            let socket = net.connect(sock, () => {
                this._app.debug('Connected to daemon').catch(() => { /* do nothing */ });
                socket.removeListener('error', onError);
                socket.once('error', error => { this.error(error); });

                let wrapper = new SocketWrapper(socket);
                wrapper.on('receive', data => {
                    this._app.debug('Got daemon reply').catch(() => { /* do nothing */ });
                    resolve(data);
                    socket.end();
                });
                wrapper.send(request);
            });
            socket.on('error', onError);
        });
    }

    /**
     * Log error and terminate
     * @param {...*} args
     */
    error(...args) {
        return args.reduce(
                (prev, cur) => {
                    return prev.then(() => {
                        return this._app.error(cur.fullStack || cur.stack || cur.message || cur);
                    });
                },
                Promise.resolve()
            )
            .then(
                () => {
                    process.exit(1);
                },
                () => {
                    process.exit(1);
                }
            );
    }

    /**
     * Initialize the command
     * @return {Promise}
     */
    init() {
        return new Promise((resolve, reject) => {
            this._app.debug('Loading protocol').catch(() => { /* do nothing */ });
            protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                if (error)
                    return this.error(error);

                try {
                    this.proto = root;
                    this.CreateRequest = this.proto.lookup('local.CreateRequest');
                    this.CreateResponse = this.proto.lookup('local.CreateResponse');
                    this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                    this.UpdateConnectionsRequest = this.proto.lookup('local.UpdateConnectionsRequest');
                    this.UpdateConnectionsResponse = this.proto.lookup('local.UpdateConnectionsResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                } catch (error) {
                    this.error(error);
                }
            });
        });
    }
}

module.exports = Create;