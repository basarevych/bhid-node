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
     */
    constructor(app, config) {
        this._app = app;
        this._config = config;
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
        return [ 'app', 'config' ];
    }

    /**
     * Run the command
     * @param {object} argv             Minimist object
     * @return {Promise}
     */
    run(argv) {
        if (argv['_'].length < 5)
            return this.error('Invalid parameters');

        let trackerName = argv['t'] || '';
        let path = argv['_'][1];
        let first = argv['_'][2];
        let direction = argv['_'][3];
        let second = argv['_'][4];

        if (first.split(':').length != 2 || second.split(':').length != 2)
            return this.error('Invalid host:port notation');

        let type;
        if (direction == '<-')
            type = this.CreateRequest.Type.SERVER;
        else if (direction == '->')
            type = this.CreateRequest.Type.CLIENT;
        else
            return this.error('Invalid direction');

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.CreateRequest = this.proto.lookup('local.CreateRequest');
                this.CreateResponse = this.proto.lookup('local.CreateResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending CREATE REQUEST`);
                let request = this.CreateRequest.create({
                    trackerName: trackerName,
                    path: path,
                    type: type,
                    connectAddress: (direction == '<-' ? first.split(':')[0] : second.split(':')[0]),
                    connectPort: (direction == '<-' ? first.split(':')[1] : second.split(':')[1]),
                    listenAddress: (direction == '<-' ? second.split(':')[0] : first.split(':')[0]),
                    listenPort: (direction == '<-' ? second.split(':')[1] : first.split(':')[1]),
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
                                    'Client token: ' + message.createResponse.clientToken +
                                    '\n' +
                                    'This daemon is configured as ' + (direction == '<-' ? 'server' : 'client')
                                );
                                process.exit(0);
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
            let socket = net.connect(sock, () => {
                debug('Connected to daemon');
                wrapper.send(request);
            });
            let wrapper = new SocketWrapper(socket);
            wrapper.on('receive', data => {
                debug('Got daemon reply');
                socket.end();
                resolve(data);
            });
            socket.on('error', error => { this.error(error); });
            socket.on('close', () => { reject(new Error('Socket terminated')); });
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