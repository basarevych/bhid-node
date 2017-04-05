/**
 * Confirm command
 * @module commands/confirm
 */
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Confirm {
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

        if (args.targets.length < 2)
            return this._help.helpConfirm(argv);

        let token = args.targets[1];
        let trackerName = args.options['tracker'] || '';
        let sockName = args.options['socket'];

        this._app.debug('Loading protocol');
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

                this._app.debug(`Sending CONFIRM REQUEST`);
                let request = this.ConfirmRequest.create({
                    trackerName: trackerName,
                    token: token,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.CONFIRM_REQUEST,
                    confirmRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer, sockName)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.CONFIRM_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.confirmResponse.response) {
                            case this.ConfirmResponse.Result.ACCEPTED:
                                this._app.debug(`Sending SET TOKEN REQUEST`);
                                request = this.SetTokenRequest.create({
                                    type: this.SetTokenRequest.Type.MASTER,
                                    token: message.confirmResponse.token,
                                });
                                message = this.ClientMessage.create({
                                    type: this.ClientMessage.Type.SET_TOKEN_REQUEST,
                                    setTokenRequest: request,
                                });
                                buffer = this.ClientMessage.encode(message).finish();
                                return this.send(buffer, sockName)
                                    .then(data => {
                                        message = this.ServerMessage.decode(data);
                                        if (message.type !== this.ServerMessage.Type.SET_TOKEN_RESPONSE)
                                            throw new Error('Invalid reply from daemon');

                                        switch (message.setTokenResponse.response) {
                                            case this.SetTokenResponse.Result.ACCEPTED:
                                                return this._app.info('Master token is saved to ~/.bhid/master.token on this computer and will be used automatically');
                                            case this.SetTokenResponse.Result.REJECTED:
                                                throw new Error('Set token request rejected');
                                            default:
                                                throw new Error('Unsupported response from daemon');
                                        }
                                    });
                            case this.ConfirmResponse.Result.REJECTED:
                                throw new Error('Request rejected');
                            case this.ConfirmResponse.Result.TIMEOUT:
                                throw new Error('No response from the tracker');
                            case this.ConfirmResponse.Result.NO_TRACKER:
                                throw new Error('Not connected to the tracker');
                            default:
                                throw new Error('Unsupported response from daemon');
                        }
                    })
                    .then(() => {
                        process.exit(0);
                    })
                    .catch(error => {
                        return this.error(error.message);
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
     * @param {string} [sockName]
     * @return {Promise}
     */
    send(request, sockName) {
        return new Promise((resolve, reject) => {
            let sock;
            if (sockName && sockName[0] === '/')
                sock = sockName;
            else
                sock = path.join('/var', 'run', this._config.project, this._config.instance + (sockName || '') + '.sock');

            let onError = error => {
                this.error(`Could not connect to daemon: ${error.message}`);
            };

            let socket = net.connect(sock, () => {
                this._app.debug('Connected to daemon');
                socket.removeListener('error', onError);
                socket.once('error', error => { this.error(error.message) });

                let wrapper = new SocketWrapper(socket);
                wrapper.on('receive', data => {
                    this._app.debug('Got daemon reply');
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
        return this._app.error(...args)
            .then(
                () => {
                    process.exit(1);
                },
                () => {
                    process.exit(1);
                }
            );
    }
}

module.exports = Confirm;