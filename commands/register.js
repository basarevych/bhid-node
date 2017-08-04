/**
 * Register command
 * @module commands/register
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Register {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Help} help               Help command
     * @param {Auth} auth               Auth command
     */
    constructor(app, config, help, auth) {
        this._app = app;
        this._config = config;
        this._help = help;
        this._auth = auth;
    }

    /**
     * Service name is 'commands.register'
     * @type {string}
     */
    static get provides() {
        return 'commands.register';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'commands.help', 'commands.auth' ];
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
                name: 'randomize',
                short: 'r',
                type: 'boolean',
            })
            .option({
                name: 'authenticate',
                short: 'a',
                type: 'boolean',
            })
            .option({
                name: 'quiet',
                short: 'q',
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

        let daemonName = args.targets[1] || '';
        let randomize = daemonName ? !!args.options.randomize : true;
        let authenticate = !!args.options.authenticate;
        let quiet = !!args.options.quiet;
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        let token;
        try {
            token = fs.readFileSync(path.join(os.homedir(), '.bhid', 'master.token'), 'utf8').trim();
            if (!token)
                throw new Error('No token');
        } catch (error) {
            return this.error('Master token not found');
        }

        this._app.debug('Loading protocol').catch(() => { /* do nothing */ });
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error);

            try {
                this.proto = root;
                this.CreateDaemonRequest = this.proto.lookup('local.CreateDaemonRequest');
                this.CreateDaemonResponse = this.proto.lookup('local.CreateDaemonResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                this._app.debug('Sending CREATE DAEMON REQUEST').catch(() => { /* do nothing */ });
                let request = this.CreateDaemonRequest.create({
                    trackerName: trackerName,
                    token: token,
                    daemonName: daemonName,
                    randomize: randomize,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.CREATE_DAEMON_REQUEST,
                    createDaemonRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer, sockName)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.CREATE_DAEMON_RESPONSE)
                            return this.error('Invalid reply from daemon');

                        switch (message.createDaemonResponse.response) {
                            case this.CreateDaemonResponse.Result.ACCEPTED:
                                if (authenticate)
                                    return this._auth.auth(message.createDaemonResponse.token, trackerName, sockName);
                                if (quiet)
                                    return this._app.info(message.createDaemonResponse.token);
                                return this._app.info(
                                    'Name: ' + message.createDaemonResponse.daemonName + '\n' +
                                    'Token: ' + message.createDaemonResponse.token
                                );
                            case this.CreateDaemonResponse.Result.REJECTED:
                                return this.error('Request rejected');
                            case this.CreateDaemonResponse.Result.INVALID_NAME:
                                return this.error('Invalid name');
                            case this.CreateDaemonResponse.Result.NAME_EXISTS:
                                return this.error('Daemon with this name already exists');
                            case this.CreateDaemonResponse.Result.TIMEOUT:
                                return this.error('No response from the tracker');
                            case this.CreateDaemonResponse.Result.NO_TRACKER:
                                return this.error('Not connected to the tracker');
                            default:
                                return this.error('Unsupported response from daemon');
                        }
                    })
                    .then(() => {
                        process.exit(0);
                    })
                    .catch(error => {
                        return this.error(error);
                    });
            } catch (error) {
                return this.error(error);
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
                sock = path.join('/var', 'run', 'bhid', `daemon${sockName ? '.' + sockName : ''}.sock`);

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

module.exports = Register;