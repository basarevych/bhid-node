/**
 * Attach command
 * @module commands/attach
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Attach {
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
     * Service name is 'commands.attach'
     * @type {string}
     */
    static get provides() {
        return 'commands.attach';
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
        if (argv['_'].length < 2)
            return this._help.helpAttach(argv);

        let apath = argv['_'][1];
        let override = argv['_'].length > 2 && argv['_'][2];
        let trackerName = argv['t'] || '';
        let randomAddress = false;
        let randomPort = false;

        let overrideAddress, overridePort;
        if (override) {
            let parts = override.split(':');
            if (parts.length == 2) {
                overrideAddress = parts[0];
                overridePort = parts[1];
            } else if (parts.length == 1 && parts[0].length && parts[0][0] == '/') {
                overrideAddress = '';
                overridePort = parts[0];
            } else {
                return this.error('Invalid override address notation');
            }
            if (overrideAddress == '*') {
                overrideAddress = '';
                randomAddress = true;
            }
            if (overridePort == '*') {
                overridePort = '';
                randomPort = true;
            }
        } else {
            overrideAddress = '';
            overridePort = '';
        }

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.AttachRequest = this.proto.lookup('local.AttachRequest');
                this.AttachResponse = this.proto.lookup('local.AttachResponse');
                this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                this.UpdateConnectionsRequest = this.proto.lookup('local.UpdateConnectionsRequest');
                this.UpdateConnectionsResponse = this.proto.lookup('local.UpdateConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending ATTACH REQUEST`);
                let request = this.AttachRequest.create({
                    trackerName: trackerName,
                    path: apath,
                    addressOverride: overrideAddress,
                    portOverride: overridePort,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.ATTACH_REQUEST,
                    attachRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.ATTACH_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.attachResponse.response) {
                            case this.AttachResponse.Result.ACCEPTED:
                                this.update(trackerName, message.attachResponse.updates, randomAddress, randomPort);
                                break;
                            case this.AttachResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.AttachResponse.Result.INVALID_PATH:
                                console.log('Invalid path');
                                process.exit(1);
                                break;
                            case this.AttachResponse.Result.PATH_NOT_FOUND:
                                console.log('Path not found');
                                process.exit(1);
                                break;
                            case this.AttachResponse.Result.ALREADY_ATTACHED:
                                console.log('Already attached');
                                process.exit(1);
                                break;
                            case this.AttachResponse.Result.TIMEOUT:
                                console.log('No response from the tracker');
                                process.exit(1);
                                break;
                            case this.AttachResponse.Result.NO_TRACKER:
                                console.log('Not connected to the tracker');
                                process.exit(1);
                                break;
                            case this.AttachResponse.Result.NOT_REGISTERED:
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
     * @param {boolean} randomAddress                   Use random address
     * @param {boolean} randomPort                      Use random port
     */
    update(trackerName, list, randomAddress, randomPort) {
        if (!list)
            process.exit(0);

        for (let connection of list.clientConnections) {
            if (randomAddress)
                connection.listenAddress = '';
            if (randomPort)
                connection.listenPort = '';
        }

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

module.exports = Attach;