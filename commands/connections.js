/**
 * Connections command
 * @module commands/connections
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
class Connections {
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
     * Service name is 'commands.connections'
     * @type {string}
     */
    static get provides() {
        return 'commands.connections';
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

        let search = args.targets.length && args.targets[1];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        this._app.debug('Loading protocol').catch(() => { /* do nothing */ });
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error);

            try {
                this.proto = root;
                this.GetConnectionsRequest = this.proto.lookup('local.GetConnectionsRequest');
                this.GetConnectionsResponse = this.proto.lookup('local.GetConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                this._app.debug('Sending CONNECTION LIST REQUEST').catch(() => { /* do nothing */ });
                let request = this.GetConnectionsRequest.create({
                    trackerName: trackerName,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.GET_CONNECTIONS_REQUEST,
                    getConnectionsRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer, sockName)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.GET_CONNECTIONS_RESPONSE)
                            return this.error('Invalid reply from daemon');

                        switch (message.getConnectionsResponse.response) {
                            case this.GetConnectionsResponse.Result.ACCEPTED:
                                return this.printTable(
                                    message.getConnectionsResponse.activeList,
                                    message.getConnectionsResponse.importedList,
                                    search || undefined
                                );
                            case this.GetConnectionsResponse.Result.REJECTED:
                                return this.error('Request rejected');
                            case this.GetConnectionsResponse.Result.NO_TRACKER:
                                return this.error('Not connected to the tracker');
                            case this.GetConnectionsResponse.Result.NOT_REGISTERED:
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
     * Print the table
     * @param {object} activeList
     * @param {object} importedList
     * @param {string} [search]
     */
    printTable(activeList, importedList, search) {
        let counter = 0;
        if (activeList) {
            counter += activeList.serverConnections.length;
            counter += activeList.clientConnections.length;
        }
        if (importedList) {
            counter += importedList.serverConnections.length;
            counter += importedList.clientConnections.length;
        }

        if (!counter)
            return this._app.info('No connections defined');

        let table = new Table();
        if (activeList) {
            activeList.serverConnections.forEach(row => {
                if (search) {
                    let parts = row.name.split('/');
                    parts[0] = '';
                    if (parts.join('/') !== search)
                        return;
                }

                table.cell('Name', row.name);
                table.cell('Status', 'online');
                table.cell('Type', 'server');
                table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
                table.cell('Fixed', row.fixed ? 'yes' : 'no');
                table.cell('Address', row.connectAddress);
                table.cell('Port', row.connectPort);
                table.newRow();
            });
            activeList.clientConnections.forEach(row => {
                if (search) {
                    let parts = row.name.split('/');
                    parts[0] = '';
                    if (parts.join('/') !== search)
                        return;
                }

                table.cell('Name', row.name);
                table.cell('Status', row.connected ? 'online' : 'offline');
                table.cell('Type', 'client');
                table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
                table.cell('Fixed', row.fixed ? 'yes' : 'no');
                table.cell('Address', row.listenAddress == '::' ? '*' : row.listenAddress || '*');
                table.cell('Port', row.listenPort || '*');
                table.newRow();
            });
        }
        if (importedList) {
            importedList.serverConnections.forEach(row => {
                if (search) {
                    let parts = row.name.split('/');
                    parts[0] = '';
                    if (parts.join('/') !== search)
                        return;
                }

                table.cell('Name', row.name);
                table.cell('Status', 'imported');
                table.cell('Type', 'server');
                table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
                table.cell('Fixed', row.fixed ? 'yes' : 'no');
                table.cell('Address', row.connectAddress);
                table.cell('Port', row.connectPort);
                table.newRow();
            });
            importedList.clientConnections.forEach(row => {
                if (search) {
                    let parts = row.name.split('/');
                    parts[0] = '';
                    if (parts.join('/') !== search)
                        return;
                }

                table.cell('Name', row.name);
                table.cell('Status', 'imported');
                table.cell('Type', 'client');
                table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
                table.cell('Fixed', row.fixed ? 'yes' : 'no');
                table.cell('Address', row.listenAddress || '*');
                table.cell('Port', row.listenPort || '*');
                table.newRow();
            });
        }
        return this._app.info(table.toString().trim());
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

module.exports = Connections;
