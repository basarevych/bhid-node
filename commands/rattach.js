/**
 * Rattach command
 * @module commands/rattach
 */
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Rattach {
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
     * Service name is 'commands.rattach'
     * @type {string}
     */
    static get provides() {
        return 'commands.rattach';
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
                name: 'server',
                short: 's',
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

        if (args.targets.length < 3)
            return this._help.helpRattach(argv);

        let apath = args.targets[1];
        let adaemon = args.targets[2];
        let override = args.targets[3] || '';
        let server = args.options.server || false;
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        let overrideAddress, overridePort;
        if (override) {
            let match = /^\[(.+)\]:(\d+)$/.exec(override);
            if (match) {
                overrideAddress = match[1];
                overridePort = match[2];
            } else {
                let parts = override.split(':');
                if (parts.length === 2) {
                    overrideAddress = parts[0];
                    overridePort = parts[1];
                } else if (parts.length === 1 && parts[0].length && parts[0][0] === '/') {
                    overrideAddress = '';
                    overridePort = parts[0];
                } else {
                    return this.error('Invalid override address');
                }
            }
        } else {
            overrideAddress = '';
            overridePort = '';
        }

        this._app.debug('Loading protocol').catch(() => { /* do nothing */ });
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error);

            try {
                this.proto = root;
                this.RemoteAttachRequest = this.proto.lookup('local.RemoteAttachRequest');
                this.RemoteAttachResponse = this.proto.lookup('local.RemoteAttachResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                this._app.debug('Sending REMOTE ATTACH REQUEST').catch(() => { /* do nothing */ });
                let request = this.RemoteAttachRequest.create({
                    trackerName: trackerName,
                    path: apath,
                    daemonName: adaemon,
                    server: server,
                    addressOverride: overrideAddress,
                    portOverride: overridePort,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.REMOTE_ATTACH_REQUEST,
                    remoteAttachRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer, sockName)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.REMOTE_ATTACH_RESPONSE)
                            return this.error('Invalid reply from daemon');

                        switch (message.remoteAttachResponse.response) {
                            case this.RemoteAttachResponse.Result.ACCEPTED:
                                break;
                            case this.RemoteAttachResponse.Result.REJECTED:
                                return this.error('Request rejected');
                            case this.RemoteAttachResponse.Result.INVALID_PATH:
                                return this.error('Invalid path');
                            case this.RemoteAttachResponse.Result.PATH_NOT_FOUND:
                                return this.error('Path not found');
                            case this.RemoteAttachResponse.Result.INVALID_ADDRESS:
                                return this.error('Invalid address');
                            case this.RemoteAttachResponse.Result.DAEMON_NOT_FOUND:
                                return this.error('Daemon not found');
                            case this.RemoteAttachResponse.Result.ALREADY_ATTACHED:
                                return this.error('Already attached');
                            case this.RemoteAttachResponse.Result.TIMEOUT:
                                return this.error('No response from the tracker');
                            case this.RemoteAttachResponse.Result.NO_TRACKER:
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

module.exports = Rattach;