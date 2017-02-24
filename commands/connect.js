/**
 * Connect command
 * @module commands/connect
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Connect {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     */
    constructor(app, config) {
        this._app = app;
        this._config = config;
    }

    /**
     * Service name is 'commands.connect'
     * @type {string}
     */
    static get provides() {
        return 'commands.connect';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config' ];
    }

    /**
     * Run the command
     * @param {object} argv             Minimist object
     * @return {Promise}
     */
    run(argv) {
        if (argv['_'].length < 2)
            return this.error('Invalid parameters');

        let token = argv['_'][1];
        let daemonName = argv['d'] || '';
        let trackerName = argv['t'] || '';

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.ConnectRequest = this.proto.lookup('local.ConnectRequest');
                this.ConnectResponse = this.proto.lookup('local.ConnectResponse');
                this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                this.UpdateConnectionsRequest = this.proto.lookup('local.UpdateConnectionsRequest');
                this.UpdateConnectionsResponse = this.proto.lookup('local.UpdateConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending CONNECT REQUEST`);
                let request = this.ConnectRequest.create({
                    trackerName: trackerName,
                    daemonName: daemonName,
                    token: token,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.CONNECT_REQUEST,
                    connectRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.CONNECT_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.connectResponse.response) {
                            case this.ConnectResponse.Result.ACCEPTED:
                                if (daemonName)
                                    process.exit(0);
                                this.update(trackerName, message.connectResponse.updates);
                                break;
                            case this.ConnectResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.ConnectResponse.Result.ALREADY_CONNECTED:
                                console.log('Already connected');
                                process.exit(1);
                                break;
                            case this.ConnectResponse.Result.TIMEOUT:
                                console.log('No response from tracker');
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

module.exports = Connect;