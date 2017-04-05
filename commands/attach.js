/**
 * Attach command
 * @module commands/attach
 */
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Attach {
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
     * Service name is 'commands.attach'
     * @type {string}
     */
    static get provides() {
        return 'commands.attach';
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
            return this._help.helpAttach(argv);

        let apath = args.targets[1];
        let override = args.targets[2] || '';
        let trackerName = args.options['tracker'] || '';
        let sockName = args.options['socket'];

        let overrideAddress, overridePort;
        if (override) {
            let parts = override.split(':');
            if (parts.length === 2) {
                overrideAddress = parts[0];
                overridePort = parts[1];
            } else if (parts.length === 1 && parts[0].length && parts[0][0] === '/') {
                overrideAddress = '';
                overridePort = parts[0];
            } else {
                return this.error('Invalid override address notation');
            }
        } else {
            overrideAddress = '';
            overridePort = '';
        }

        this._app.debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.AttachRequest = this.proto.lookup('local.AttachRequest');
                this.AttachResponse = this.proto.lookup('local.AttachResponse');
                this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                this.UpdateConnectionsRequest = this.proto.lookup('local.UpdateConnectionsRequest');
                this.UpdateConnectionsResponse = this.proto.lookup('local.UpdateConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                this._app.debug(`Sending ATTACH REQUEST`);
                let request = this.AttachRequest.create({
                    trackerName: trackerName,
                    path: apath,
                    addressOverride: overrideAddress,
                    portOverride: overridePort,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.ATTACH_REQUEST,
                    attachRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer, sockName)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.ATTACH_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.attachResponse.response) {
                            case this.AttachResponse.Result.ACCEPTED:
                                return this.update(trackerName, message.attachResponse.updates, sockName);
                            case this.AttachResponse.Result.REJECTED:
                                throw new Error('Request rejected');
                            case this.AttachResponse.Result.INVALID_PATH:
                                throw new Error('Invalid path');
                            case this.AttachResponse.Result.PATH_NOT_FOUND:
                                throw new Error('Path not found');
                            case this.AttachResponse.Result.ALREADY_ATTACHED:
                                throw new Error('Already attached');
                            case this.AttachResponse.Result.TIMEOUT:
                                throw new Error('No response from the tracker');
                            case this.AttachResponse.Result.NO_TRACKER:
                                throw new Error('Not connected to the tracker');
                            case this.AttachResponse.Result.NOT_REGISTERED:
                                throw new Error('Not registered with the tracker');
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
     * Load the connection
     * @param {string} trackerName                      Name of the tracker
     * @param {object} [list]                           List of updated connections
     * @param {string} [sockName]                       Name of socket
     * @return {Promise}
     */
    update(trackerName, list, sockName) {
        if (!list)
            return Promise.resolve();

        let request = this.UpdateConnectionsRequest.create({
            trackerName: trackerName,
            list: list,
        });
        let message = this.ClientMessage.create({
            type: this.ClientMessage.Type.UPDATE_CONNECTIONS_REQUEST,
            updateConnectionsRequest: request,
        });
        let buffer = this.ClientMessage.encode(message).finish();
        return this.send(buffer, sockName)
            .then(data => {
                let message = this.ServerMessage.decode(data);
                if (message.type !== this.ServerMessage.Type.UPDATE_CONNECTIONS_RESPONSE)
                    throw new Error('Invalid reply from daemon');

                switch (message.updateConnectionsResponse.response) {
                    case this.UpdateConnectionsResponse.Result.ACCEPTED:
                        return;
                    case this.UpdateConnectionsResponse.Result.REJECTED:
                        throw new Error('Could not start the connection');
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

module.exports = Attach;