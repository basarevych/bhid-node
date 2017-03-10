/**
 * List command
 * @module commands/list
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const read = require('read');
const SocketWrapper = require('socket-wrapper');
const Table = require('easy-table');

/**
 * Command class
 */
class List {
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
     * Service name is 'commands.list'
     * @type {string}
     */
    static get provides() {
        return 'commands.list';
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
     * @param {object} argv             Minimist object
     * @return {Promise}
     */
    run(argv) {
        let trackerName = argv['t'] || '';
        let sockName = argv['z'];

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.ConnectionsListRequest = this.proto.lookup('local.ConnectionsListRequest');
                this.ConnectionsListResponse = this.proto.lookup('local.ConnectionsListResponse');
                this.GetConnectionsRequest = this.proto.lookup('local.GetConnectionsRequest');
                this.GetConnectionsResponse = this.proto.lookup('local.GetConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending CONNECTION LIST REQUEST`);
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
                            throw new Error('Invalid reply from daemon');

                        switch (message.getConnectionsResponse.response) {
                            case this.GetConnectionsResponse.Result.ACCEPTED:
                                this.printTable(
                                    message.getConnectionsResponse.activeList,
                                    message.getConnectionsResponse.importedList
                                );
                                process.exit(0);
                                break;
                            case this.GetConnectionsResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.ConnectionsListResponse.Result.NO_TRACKER:
                                console.log('Not connected to the tracker');
                                process.exit(1);
                                break;
                            case this.ConnectionsListResponse.Result.NOT_REGISTERED:
                                console.log('Not registered with the tracker');
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
     * Print the table
     * @param {object} activeList
     * @param {object} importedList
     */
    printTable(activeList, importedList) {
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
            return console.log('No connections defined');

        let table = new Table();
        if (activeList) {
            activeList.serverConnections.forEach(row => {
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
        console.log(table.toString().trim());
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

module.exports = List;
