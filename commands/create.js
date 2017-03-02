/**
 * Create command
 * @module commands/create
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
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
     * @param {object} argv             Minimist object
     * @return {Promise}
     */
    run(argv) {
        if (argv['_'].length < 3)
            return this._help.helpCreate(argv);

        let cpath = argv['_'][1];
        let first = argv['_'][2];
        let second = argv['_'].length > 3 && argv['_'][3];
        let server = !!argv['s'];
        let client = !!argv['c'];
        let encrypted = !!argv['e'];
        let fixed = !!argv['f'];
        let trackerName = argv['t'] || '';

        if (server && client)
            return this.error('Daemon cannot be a server and a client of the same connection at the same time');

        let firstAddress, firstPort;
        let parts = first.split(':');
        if (parts.length == 2) {
            firstAddress = parts[0];
            firstPort = parts[1];
        } else if (parts.length == 1 && parts[0].length && parts[0][0] == '/') {
            firstAddress = '';
            firstPort = parts[0];
        } else {
            return this.error('Invalid connect address notation');
        }

        let secondAddress, secondPort;
        if (second) {
            parts = second.split(':');
            if (parts.length == 2) {
                secondAddress = parts[0];
                secondPort = parts[1];
            } else if (parts.length == 1 && parts[0].length && parts[0][0] == '/') {
                secondAddress = '';
                secondPort = parts[0];
            } else {
                return this.error('Invalid listen address notation');
            }
        } else {
            secondAddress = '';
            secondPort = '';
        }

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.CreateRequest = this.proto.lookup('local.CreateRequest');
                this.CreateResponse = this.proto.lookup('local.CreateResponse');
                this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                this.UpdateConnectionsRequest = this.proto.lookup('local.UpdateConnectionsRequest');
                this.UpdateConnectionsResponse = this.proto.lookup('local.UpdateConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                let type = this.CreateRequest.Type.NOT_CONNECTED;
                if (server)
                    type = this.CreateRequest.Type.SERVER;
                else if (client)
                    type = this.CreateRequest.Type.CLIENT;

                debug(`Sending CREATE REQUEST`);
                let request = this.CreateRequest.create({
                    trackerName: trackerName,
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
                this.send(buffer)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.CREATE_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.createResponse.response) {
                            case this.CreateResponse.Result.ACCEPTED:
                                console.log(
                                    'Server token: ' + message.createResponse.serverToken +
                                    '\n' +
                                    'Client token: ' + message.createResponse.clientToken
                                );
                                if (type != this.CreateRequest.Type.NOT_CONNECTED) {
                                    console.log('This daemon is configured as ' + (client ? 'client' : 'server'));
                                }
                                if (type == this.CreateRequest.Type.NOT_CONNECTED)
                                    process.exit(0);
                                this.update(trackerName, message.createResponse.updates);
                                break;
                            case this.CreateResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.CreateResponse.Result.INVALID_PATH:
                                console.log('Invalid path');
                                process.exit(1);
                                break;
                            case this.CreateResponse.Result.PATH_EXISTS:
                                console.log('Path exists');
                                process.exit(1);
                                break;
                            case this.CreateResponse.Result.TIMEOUT:
                                console.log('No response from the tracker');
                                process.exit(1);
                                break;
                            case this.CreateResponse.Result.NO_TRACKER:
                                console.log('Not connected to the tracker');
                                process.exit(1);
                                break;
                            case this.CreateResponse.Result.NOT_REGISTERED:
                                console.log('Not registered with the tracker');
                                process.exit(1);
                                break;
                            default:
                                throw new Error('Unsupported response from daemon');
                        }
                    })
                    .catch(error => {
                        this.error(error.message);
                    });
            } catch (error) {
                return this.error(error.message);
            }
        });

        return Promise.resolve();
    }

    /**
     * Load the connection
     * @param {string} trackerName                      Name of the tracker
     * @param {object} [list]                           List of updated connections
     */
    update(trackerName, list) {
        if (!list)
            process.exit(0);

        let request = this.UpdateConnectionsRequest.create({
            trackerName: trackerName,
            list: list,
        });
        let message = this.ClientMessage.create({
            type: this.ClientMessage.Type.UPDATE_CONNECTIONS_REQUEST,
            updateConnectionsRequest: request,
        });
        let buffer = this.ClientMessage.encode(message).finish();
        this.send(buffer)
            .then(data => {
                let message = this.ServerMessage.decode(data);
                if (message.type !== this.ServerMessage.Type.UPDATE_CONNECTIONS_RESPONSE)
                    throw new Error('Invalid reply from daemon');

                switch (message.updateConnectionsResponse.response) {
                    case this.UpdateConnectionsResponse.Result.ACCEPTED:
                        process.exit(0);
                        break;
                    case this.UpdateConnectionsResponse.Result.REJECTED:
                        console.log('Could not start the connection');
                        process.exit(1);
                        break;
                    default:
                        throw new Error('Unsupported response from daemon');
                }
            })
            .catch(error => {
                this.error(error.message);
            });
    }

    /**
     * Send request and return response
     * @param {Buffer} request
     * @return {Promise}
     */
    send(request) {
        return new Promise((resolve, reject) => {
            let sock = path.join('/var', 'run', this._config.project, this._config.instance + '.sock');
            let attempts = 0;
            let connect = () => {
                if (++attempts > 10)
                    return reject(new Error('Could not connect to daemon'));

                let connected = false;
                let socket = net.connect(sock, () => {
                    debug('Connected to daemon');
                    connected = true;
                    socket.once('error', error => { this.error(error.message) });

                    let wrapper = new SocketWrapper(socket);
                    wrapper.on('receive', data => {
                        debug('Got daemon reply');
                        resolve(data);
                        socket.end();
                    });
                    wrapper.send(request);
                });
                socket.once('close', () => {
                    if (connected)
                        reject(new Error('Socket terminated'));
                    else
                        setTimeout(() => { connect(); }, 500);
                });
            };
            connect();
        });
    }

    /**
     * Log error and terminate
     * @param {...*} args
     */
    error(...args) {
        console.error(...args);
        process.exit(1);
    }
}

module.exports = Create;