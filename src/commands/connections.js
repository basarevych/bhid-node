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
const Base = require('./base');

/**
 * Command class
 */
class Connections extends Base {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     */
    constructor(app, config) {
        super(app);
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
    async run(argv) {
        let args = argvParser
            .option({
                name: 'help',
                short: 'h',
                type: 'boolean',
            })
            .option({
                name: 'no-header',
                short: 'n',
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
        let noHeader = args.options['no-header'] || false;
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.GetConnectionsRequest = this.proto.lookup('local.GetConnectionsRequest');
                    this.GetConnectionsResponse = this.proto.lookup('local.GetConnectionsResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending CONNECTION LIST REQUEST');
            let request = this.GetConnectionsRequest.create({
                trackerName: trackerName,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.GET_CONNECTIONS_REQUEST,
                getConnectionsRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.GET_CONNECTIONS_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.getConnectionsResponse.response) {
                case this.GetConnectionsResponse.Result.ACCEPTED:
                    await this.printTable(
                        reply.getConnectionsResponse.activeList,
                        reply.getConnectionsResponse.importedList,
                        !noHeader,
                        search || undefined
                    );
                    return 0;
                case this.GetConnectionsResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.GetConnectionsResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                case this.GetConnectionsResponse.Result.NOT_REGISTERED:
                    return this.error('Not registered with the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            await this.error(error);
        }
    }

    /**
     * Print the table
     * @param {object} activeList
     * @param {object} importedList
     * @param {boolean} printHeader
     * @param {string} [search]
     * @return {Promise}
     */
    async printTable(activeList, importedList, printHeader, search) {
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
                table.cell('Address', row.listenAddress === '::' ? '*' : row.listenAddress || '*');
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

        let result = table.toString().trim();
        if (printHeader)
            return this._app.info(result);

        return this._app.info(result.split('\n').splice(2).join('\n'));
    }
}

module.exports = Connections;
