/**
 * Confirm command
 * @module commands/confirm
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Confirm {
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
     * Service name is 'commands.confirm'
     * @type {string}
     */
    static get provides() {
        return 'commands.confirm';
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
        let trackerName = argv['t'] || '';

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.ConfirmRequest = this.proto.lookup('local.ConfirmRequest');
                this.ConfirmResponse = this.proto.lookup('local.ConfirmResponse');
                this.SetTokenRequest = this.proto.lookup('local.SetTokenRequest');
                this.SetTokenResponse = this.proto.lookup('local.SetTokenResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending CONFIRM REQUEST`);
                let request = this.ConfirmRequest.create({
                    trackerName: trackerName,
                    token: token,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.CONFIRM_REQUEST,
                    confirmRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.CONFIRM_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.confirmResponse.response) {
                            case this.ConfirmResponse.Result.ACCEPTED:
                                console.log('Your daemon token is ' + message.confirmResponse.token);
                                debug(`Sending SET TOKEN REQUEST`);
                                request = this.SetTokenRequest.create({
                                    trackerName: trackerName,
                                    token: message.confirmResponse.token,
                                });
                                message = this.ClientMessage.create({
                                    type: this.ClientMessage.Type.SET_TOKEN_REQUEST,
                                    setTokenRequest: request,
                                });
                                buffer = this.ClientMessage.encode(message).finish();
                                this.send(buffer)
                                    .then(data => {
                                        message = this.ServerMessage.decode(data);
                                        if (message.type !== this.ServerMessage.Type.SET_TOKEN_RESPONSE)
                                            throw new Error('Invalid reply from daemon');

                                        switch (message.setTokenResponse.response) {
                                            case this.SetTokenResponse.Result.ACCEPTED:
                                                console.log('It has been saved in the configuration and will be used automatically with this tracker');
                                                process.exit(0);
                                                break;
                                            case this.SetTokenResponse.Result.REJECTED:
                                                console.log('Save request rejected');
                                                process.exit(1);
                                                break;
                                            default:
                                                throw new Error('Unsupported response from daemon');
                                        }
                                    })
                                    .catch(error => {
                                        this.error(error.message);
                                    });
                                break;
                            case this.ConfirmResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.ConfirmResponse.Result.TIMEOUT:
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

module.exports = Confirm;