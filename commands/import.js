/**
 * Import command
 * @module commands/import
 */
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Import {
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
     * Service name is 'commands.import'
     * @type {string}
     */
    static get provides() {
        return 'commands.import';
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
            return this._help.helpImport(argv);

        let token = args.targets[1];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        this._app.debug('Loading protocol').catch(() => { /* do nothing */ });
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error);

            try {
                this.proto = root;
                this.ImportRequest = this.proto.lookup('local.ImportRequest');
                this.ImportResponse = this.proto.lookup('local.ImportResponse');
                this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                this.ImportConnectionsRequest = this.proto.lookup('local.ImportConnectionsRequest');
                this.ImportConnectionsResponse = this.proto.lookup('local.ImportConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                this._app.debug('Sending IMPORT REQUEST').catch(() => { /* do nothing */ });
                let request = this.ImportRequest.create({
                    trackerName: trackerName,
                    token: token,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.IMPORT_REQUEST,
                    importRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer, sockName)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.IMPORT_RESPONSE)
                            return this.error('Invalid reply from daemon');

                        switch (message.importResponse.response) {
                            case this.ImportResponse.Result.ACCEPTED:
                                return this.importConnections(trackerName, token, message.importResponse.updates, sockName);
                            case this.ImportResponse.Result.REJECTED:
                                return this.error('Request rejected');
                            case this.ImportResponse.Result.ALREADY_CONNECTED:
                                return this.error('Already connected');
                            case this.ImportResponse.Result.TIMEOUT:
                                return this.error('No response from the tracker');
                            case this.ImportResponse.Result.NO_TRACKER:
                                return this.error('Not connected to the tracker');
                            case this.ImportResponse.Result.NOT_REGISTERED:
                                return this.error('Not registered with the tracker');
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
     * import the connection
     * @param {string} trackerName                      Name of the tracker
     * @param {string} token                            The token
     * @param {object} [list]                           List of updated connections
     * @param {string} [sockName]                       Socket name
     */
    importConnections(trackerName, token, list, sockName) {
        if (!list)
            return Promise.resolve();

        let request = this.ImportConnectionsRequest.create({
            trackerName: trackerName,
            token: token,
            list: list,
        });
        let message = this.ClientMessage.create({
            type: this.ClientMessage.Type.IMPORT_CONNECTIONS_REQUEST,
            importConnectionsRequest: request,
        });
        let buffer = this.ClientMessage.encode(message).finish();
        return this.send(buffer, sockName)
            .then(data => {
                let message = this.ServerMessage.decode(data);
                if (message.type !== this.ServerMessage.Type.IMPORT_CONNECTIONS_RESPONSE)
                    return this.error('Invalid reply from daemon');

                switch (message.importConnectionsResponse.response) {
                    case this.ImportConnectionsResponse.Result.ACCEPTED:
                        let msg = [];
                        for (let connection of list.serverConnections)
                            msg.push(`Server of ${connection.name}`);
                        for (let connection of list.clientConnections)
                            msg.push(`Client of ${connection.name}`);
                        return this._app.info(msg.join('\n'));
                    case this.ImportConnectionsResponse.Result.REJECTED:
                        return this.error('Could not import the connections');
                    default:
                        return this.error('Unsupported response from daemon');
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

module.exports = Import;