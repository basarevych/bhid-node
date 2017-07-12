/**
 * Auth command
 * @module commands/auth
 */
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Auth {
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
     * Service name is 'commands.auth'
     * @type {string}
     */
    static get provides() {
        return 'commands.auth';
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
            return this._help.helpAuth(argv);

        let token = args.targets[1];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        return this.auth(token, trackerName, sockName)
            .then(() => {
                process.exit(0);
            })
            .catch(error => {
                return this.error(error);
            });
    }

    /**
     * Authenticate the daemon
     * @param {string} token
     * @param {string} [trackerName]
     * @param {string} [sockName]
     * @returns {Promise}
     */
    auth(token, trackerName, sockName) {
        this._app.debug('Loading protocol').catch(() => { /* do nothing */ });
        return new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    try {
                        this.proto = root;
                        this.SetTokenRequest = this.proto.lookup('local.SetTokenRequest');
                        this.SetTokenResponse = this.proto.lookup('local.SetTokenResponse');
                        this.ClientMessage = this.proto.lookup('local.ClientMessage');
                        this.ServerMessage = this.proto.lookup('local.ServerMessage');
                        resolve();
                    } catch (error) {
                        return this.error(error);
                    }
                });
            })
            .then(() => {
                this._app.debug('Sending SET TOKEN REQUEST').catch(() => { /* do nothing */ });
                let request = this.SetTokenRequest.create({
                    type: this.SetTokenRequest.Type.DAEMON,
                    token: token,
                    trackerName: trackerName,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.SET_TOKEN_REQUEST,
                    setTokenRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                return this.send(buffer, sockName)
                    .then(data => {
                        message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.SET_TOKEN_RESPONSE)
                            return this.error('Invalid reply from daemon');

                        switch (message.setTokenResponse.response) {
                            case this.SetTokenResponse.Result.ACCEPTED:
                                return;
                            case this.SetTokenResponse.Result.REJECTED:
                                return this.error('Request rejected');
                            default:
                                return this.error('Unsupported response from daemon');
                        }
                    });
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
            if (sockName && sockName[0] === '/') {
                sock = sockName;
            } else {
                sockName = sockName ? `.${sockName}` : '';
                sock = path.join('/var', 'run', this._config.project, this._config.instance + sockName + '.sock');
            }

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
}

module.exports = Auth;