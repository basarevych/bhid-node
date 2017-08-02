/**
 * Load command
 * @module commands/load
 */
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const read = require('read');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');
const Table = require('easy-table');

/**
 * Command class
 */
class Load {
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
     * Service name is 'commands.load'
     * @type {string}
     */
    static get provides() {
        return 'commands.load';
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
                name: 'force',
                short: 'f',
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

        let trackerName = args.options.tracker || '';
        let force = !!args.options.force;
        let sockName = args.options.socket;

        return this.init()
            .then(() => {
                this._app.debug('Sending CONNECTION LIST REQUEST').catch(() => { /* do nothing */ });
                let request = this.ConnectionsListRequest.create({
                    trackerName: trackerName,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.CONNECTIONS_LIST_REQUEST,
                    connectionsListRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                return this.send(buffer, sockName);
            })
            .then(data => {
                let message = this.ServerMessage.decode(data);
                if (message.type !== this.ServerMessage.Type.CONNECTIONS_LIST_RESPONSE)
                    return this.error('Invalid reply from daemon');

                switch (message.connectionsListResponse.response) {
                    case this.ConnectionsListResponse.Result.ACCEPTED:
                        if (force) {
                            return this.load(trackerName, message.connectionsListResponse.list, sockName);
                        } else {
                            return this.printTable(message.connectionsListResponse.list)
                                .then(() => {
                                    return new Promise((resolve, reject) => {
                                        read({ prompt: '\nAccept? (yes/no): ' }, (error, answer) => {
                                            if (error)
                                                return reject(error);

                                            resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
                                        });
                                    });
                                })
                                .then(load => {
                                    if (load)
                                        return this.load(trackerName, message.connectionsListResponse.list, sockName);
                                });
                        }
                        break;
                    case this.ConnectionsListResponse.Result.REJECTED:
                        return this.error('Request rejected');
                    case this.ConnectionsListResponse.Result.TIMEOUT:
                        return this.error('No response from the tracker');
                    case this.ConnectionsListResponse.Result.NO_TRACKER:
                        return this.error('Not connected to the tracker');
                    case this.ConnectionsListResponse.Result.NOT_REGISTERED:
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
    }

    /**
     * Print the table
     * @param {object} list
     * @return {Promise}
     */
    printTable(list) {
        if (!list.serverConnections.length && !list.clientConnections.length)
            return this._app.info('No connections defined');

        let table = new Table();
        list.serverConnections.forEach(row => {
            table.cell('Name', row.name);
            table.cell('Type', 'server');
            table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
            table.cell('Fixed', row.fixed ? 'yes' : 'no');
            table.cell('Address', row.connectAddress);
            table.cell('Port', row.connectPort);
            table.cell('Peers', row.clients.length ? row.clients.join(', ') : '');
            table.newRow();
        });
        list.clientConnections.forEach(row => {
            table.cell('Name', row.name);
            table.cell('Type', 'client');
            table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
            table.cell('Fixed', row.fixed ? 'yes' : 'no');
            table.cell('Address', row.listenAddress);
            table.cell('Port', row.listenPort);
            table.cell('Peers', row.server);
            table.newRow();
        });
        return this._app.info(table.toString().trim());
    }

    /**
     * Load the list
     * @param {string} trackerName                      Name of the tracker
     * @param {object} list                             List as in the protocol
     * @param {string} [sockName]                       Socket name
     * @return {Promise}
     */
    load(trackerName, list, sockName) {
        return Promise.resolve()
            .then(() => {
                if (!this.proto)
                    return this.init();
            })
            .then(() => {
                let request = this.SetConnectionsRequest.create({
                    trackerName: trackerName,
                    list: list,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.SET_CONNECTIONS_REQUEST,
                    setConnectionsRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                return this.send(buffer, sockName);
            })
            .then(data => {
                let message = this.ServerMessage.decode(data);
                if (message.type !== this.ServerMessage.Type.SET_CONNECTIONS_RESPONSE)
                    return this.error('Invalid reply from daemon');

                switch (message.setConnectionsResponse.response) {
                    case this.SetConnectionsResponse.Result.ACCEPTED:
                        return;
                    case this.SetConnectionsResponse.Result.REJECTED:
                        return this.error('Request rejected');
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

    /**
     * Initialize the command
     * @return {Promise}
     */
    init() {
        return new Promise((resolve, reject) => {
            this._app.debug('Loading protocol').catch(() => { /* do nothing */ });
            protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                if (error)
                    return this.error(error);

                try {
                    this.proto = root;
                    this.ConnectionsListRequest = this.proto.lookup('local.ConnectionsListRequest');
                    this.ConnectionsListResponse = this.proto.lookup('local.ConnectionsListResponse');
                    this.SetConnectionsRequest = this.proto.lookup('local.SetConnectionsRequest');
                    this.SetConnectionsResponse = this.proto.lookup('local.SetConnectionsResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                } catch (error) {
                    this.error(error);
                }
            });
        });
    }
}

module.exports = Load;