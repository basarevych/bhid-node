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
        if (argv['_'].length < 4)
            return this.error('Invalid parameters');

        let cpath = argv['_'][1];
        let first = argv['_'][2];
        let second = argv['_'][3];
        let server = !!argv['s'];
        let client = !!argv['c'];
        let encrypted = !!argv['e'];
        let fixed = !!argv['f'];
        let daemonName = argv['d'] || '';
        let trackerName = argv['t'] || '';

        if (server && client)
            return this.error('Daemon cannot be a server and a client of the same connection at the same time');

        let parts = first.split(':');
        let firstAddress, firstPort;
        if (parts.length == 2) {
            firstAddress = parts[0];
            firstPort = parts[1];
        } else if (parts.length == 1 && parts[0].length && parts[0][0] == '/') {
            firstAddress = '';
            firstPort = parts[0];
        } else {
            return this.error('Invalid connect address notation');
        }

        parts = second.split(':');
        let secondAddress, secondPort;
        if (parts.length == 2) {
            secondAddress = parts[0];
            secondPort = parts[1];
        } else if (parts.length == 1 && parts[0].length && parts[0][0] == '/') {
            secondAddress = '';
            secondPort = parts[0];
        } else {
            return this.error('Invalid listen address notation');
        }

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

                let type = this.CreateRequest.Type.NOT_CONNECTED;
                if (server)
                    type = this.CreateRequest.Type.SERVER;
                else if (client)
                    type = this.CreateRequest.Type.CLIENT;

                debug(`Sending CREATE REQUEST`);
                let request = this.CreateRequest.create({
                    trackerName: trackerName,
                    daemonName: daemonName,
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
                                    'Client token: ' + message.createResponse.clientToken +
                                    '\n' +
                                    (daemonName ? `Daemon ${daemonName}` : 'This daemon') +
                                    ' is configured as ' + (client ? 'client' : 'server')
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