/**
 * Register command
 * @module commands/register
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const protobuf = require('protobufjs');
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
     * @param {object} argv             Minimist object
     * @return {Promise}
     */
    run(argv) {
        let token;
        try {
            token = fs.readFileSync(path.join(os.homedir(), '.bhid', 'master.token'), 'utf8').trim();
            if (!token)
                throw new Error('No token');
        } catch (error) {
            return this.error('Master token not found');
        }

        let daemonName = argv['_'][1] || '';
        let randomize = daemonName ? !!argv['r'] || false : true;
        let authenticate = !!argv['a'];
        let trackerName = argv['t'] || '';
        let sockName = argv['z'];

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.CreateDaemonRequest = this.proto.lookup('local.CreateDaemonRequest');
                this.CreateDaemonResponse = this.proto.lookup('local.CreateDaemonResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending CREATE DAEMON REQUEST`);
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
                            throw new Error('Invalid reply from daemon');

                        switch (message.createDaemonResponse.response) {
                            case this.CreateDaemonResponse.Result.ACCEPTED:
                                if (authenticate) {
                                    return this._auth.auth(message.createDaemonResponse.token, trackerName, sockName);
                                } else {
                                    console.log(
                                        'Name: ' + message.createDaemonResponse.daemonName + '\n' +
                                        'Token: ' + message.createDaemonResponse.token
                                    );
                                    process.exit(0);
                                }
                                break;
                            case this.CreateDaemonResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.CreateDaemonResponse.Result.INVALID_NAME:
                                console.log('Invalid name');
                                process.exit(1);
                                break;
                            case this.CreateDaemonResponse.Result.NAME_EXISTS:
                                console.log('Daemon with this name already exists');
                                process.exit(1);
                                break;
                            case this.CreateDaemonResponse.Result.TIMEOUT:
                                console.log('No response from the tracker');
                                process.exit(1);
                                break;
                            case this.CreateDaemonResponse.Result.NO_TRACKER:
                                console.log('Not connected to the tracker');
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

module.exports = Register;