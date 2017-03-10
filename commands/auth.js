/**
 * Auth command
 * @module commands/auth
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
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
     * @param {object} argv             Minimist object
     * @return {Promise}
     */
    run(argv) {
        if (argv['_'].length < 2)
            return this._help.helpAuth(argv);

        let token = argv['_'][1];
        let trackerName = argv['t'] || '';
        let sockName = argv['z'];

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.SetTokenRequest = this.proto.lookup('local.SetTokenRequest');
                this.SetTokenResponse = this.proto.lookup('local.SetTokenResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');
                this.auth(token, trackerName, sockName)
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
     * Authenticate the daemon
     * @param {string} token
     * @param {string} [trackerName]
     * @param {string} [sockName]
     * @returns {Promise}
     */
    auth(token, trackerName, sockName) {
        debug(`Sending SET TOKEN REQUEST`);
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
                    throw new Error('Invalid reply from daemon');

                switch (message.setTokenResponse.response) {
                    case this.SetTokenResponse.Result.ACCEPTED:
                        process.exit(0);
                        break;
                    case this.SetTokenResponse.Result.REJECTED:
                        console.log('Request rejected');
                        process.exit(1);
                        break;
                    default:
                        throw new Error('Unsupported response from daemon');
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
            if (sockName && sockName[0] == '/')
                sock = sockName;
            else
                sock = path.join('/var', 'run', this._config.project, this._config.instance + (sockName || '') + '.sock');

            let onError = error => {
                this.error(`Could not connect to daemon: ${error.message}`);
            };

            let socket = net.connect(sock, () => {
                debug('Connected to daemon');
                socket.removeListener('error', onError);
                socket.once('error', error => { this.error(error.message) });

                let wrapper = new SocketWrapper(socket);
                wrapper.on('receive', data => {
                    debug('Got daemon reply');
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
        console.error(...args);
        process.exit(1);
    }
}

module.exports = Auth;