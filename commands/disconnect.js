/**
 * Disconnect command
 * @module commands/disconnect
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Disconnect {
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
     * Service name is 'commands.disconnect'
     * @type {string}
     */
    static get provides() {
        return 'commands.disconnect';
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

        let dpath = argv['_'][1];
        let daemonName = argv['d'] || '';
        let trackerName = argv['t'] || '';

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.DisconnectRequest = this.proto.lookup('local.DisconnectRequest');
                this.DisconnectResponse = this.proto.lookup('local.DisconnectResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending DISCONNECT REQUEST`);
                let request = this.DisconnectRequest.create({
                    trackerName: trackerName,
                    daemonName: daemonName,
                    path: dpath,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.DISCONNECT_REQUEST,
                    disconnectRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.DISCONNECT_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.disconnectResponse.response) {
                            case this.DisconnectResponse.Result.ACCEPTED:
                                console.log('Disconnected');
                                process.exit(0);
                                break;
                            case this.DisconnectResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.DisconnectResponse.Result.INVALID_PATH:
                                console.log('Invalid path');
                                process.exit(1);
                                break;
                            case this.DisconnectResponse.Result.PATH_NOT_FOUND:
                                console.log('Path not found');
                                process.exit(1);
                                break;
                            case this.DisconnectResponse.Result.NOT_CONNECTED:
                                console.log('Not connected');
                                process.exit(1);
                                break;
                            case this.DisconnectResponse.Result.TIMEOUT:
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

                let socket = net.connect(sock, () => {
                    debug('Connected to daemon');
                    socket.on('error', error => { this.error(error); });
                    socket.on('close', () => { reject(new Error('Socket terminated')); });

                    let wrapper = new SocketWrapper(socket);
                    wrapper.on('receive', data => {
                        debug('Got daemon reply');
                        socket.end();
                        resolve(data);
                    });
                    wrapper.send(request);
                });
                socket.once('close', () => { setTimeout(() => { connect(); }, 500); });
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

module.exports = Disconnect;