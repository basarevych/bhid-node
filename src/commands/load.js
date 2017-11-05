/**
 * Load command
 * @module commands/load
 */
const path = require('path');
const protobuf = require('protobufjs');
const read = require('read');
const argvParser = require('argv');
const Table = require('easy-table');
const Base = require('./base');

/**
 * Command class
 */
class Load extends Base {
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
    async run(argv) {
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

        try {
            await this.init();
            let list = await this.request(trackerName, sockName);
            if (force) {
                await this.load(trackerName, list, sockName);
            } else {
                await this.printTable(list);
                let load = await new Promise((resolve, reject) => {
                    read({ prompt: '\nAccept? (yes/no): ' }, (error, answer) => {
                        if (error)
                            return reject(error);

                        resolve(['y', 'yes'].includes(answer.toLowerCase()));
                    });
                });
                if (load)
                    await this.load(trackerName, list, sockName);
            }
            return 0;
        } catch (error) {
            return this.error(error);
        }
    }

    /**
     * Initialize the command
     * @return {Promise}
     */
    async init() {
        await this._app.debug('Loading protocol');
        return new Promise((resolve, reject) => {
            protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                if (error)
                    return reject(error);

                this.proto = root;
                this.ConnectionsListRequest = this.proto.lookup('local.ConnectionsListRequest');
                this.ConnectionsListResponse = this.proto.lookup('local.ConnectionsListResponse');
                this.SetConnectionsRequest = this.proto.lookup('local.SetConnectionsRequest');
                this.SetConnectionsResponse = this.proto.lookup('local.SetConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');
                resolve();
            });
        });
    }

    /**
     * Print the table
     * @param {object} list
     * @return {Promise}
     */
    async printTable(list) {
        if (!list.serverConnections.length && !list.clientConnections.length)
            return this._app.info('No connections defined');

        let table = new Table();

        let fixed = list.serverConnections.some(item => { return item.fixed; });
        list.serverConnections.forEach(row => {
            table.cell('Name', row.name);
            table.cell('Type', 'server');
            table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
            table.cell('Fixed', row.fixed ? 'yes' : 'no');
            table.cell('Address', row.connectAddress);
            table.cell('Port', row.connectPort);
            if (fixed) {
                table.cell('Peers', row.clients.length ? row.clients[0] : '');
                table.newRow();
                for (let i = 1; i < row.clients.length; i++) {
                    table.cell('Name', '');
                    table.cell('Type', '');
                    table.cell('Encrypted', '');
                    table.cell('Fixed', '');
                    table.cell('Address', '');
                    table.cell('Port', '');
                    table.cell('Peers', row.clients[i]);
                    table.newRow();
                }
            } else {
                table.newRow();
            }
        });

        fixed = list.clientConnections.some(item => { return item.fixed; });
        list.clientConnections.forEach(row => {
            table.cell('Name', row.name);
            table.cell('Type', 'client');
            table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
            table.cell('Fixed', row.fixed ? 'yes' : 'no');
            table.cell('Address', row.listenAddress);
            table.cell('Port', row.listenPort);
            if (fixed)
                table.cell('Peers', row.server);
            table.newRow();
        });
        return this._app.info(table.toString().trim());
    }

    /**
     * Request the list
     * @param {string} trackerName                      Name of the tracker
     * @param {string} [sockName]                       Socket name
     * @return {Promise}
     */
    async request(trackerName, sockName) {
        await this._app.debug('Sending CONNECTION LIST REQUEST');
        let request = this.ConnectionsListRequest.create({
            trackerName: trackerName,
        });
        let message = this.ClientMessage.create({
            type: this.ClientMessage.Type.CONNECTIONS_LIST_REQUEST,
            connectionsListRequest: request,
        });
        let buffer = this.ClientMessage.encode(message).finish();
        let data = await this.send(buffer, sockName);

        let reply = this.ServerMessage.decode(data);
        if (reply.type !== this.ServerMessage.Type.CONNECTIONS_LIST_RESPONSE)
            return this.error('Invalid reply from daemon');

        switch (reply.connectionsListResponse.response) {
            case this.ConnectionsListResponse.Result.ACCEPTED:
                return reply.connectionsListResponse.list;
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
    }

    /**
     * Load the list
     * @param {string} trackerName                      Name of the tracker
     * @param {object} list                             List as in the protocol
     * @param {string} [sockName]                       Socket name
     * @return {Promise}
     */
    async load(trackerName, list, sockName) {
        if (!this.proto)
            await this.init();

        let request = this.SetConnectionsRequest.create({
            trackerName: trackerName,
            list: list,
        });
        let message = this.ClientMessage.create({
            type: this.ClientMessage.Type.SET_CONNECTIONS_REQUEST,
            setConnectionsRequest: request,
        });
        let buffer = this.ClientMessage.encode(message).finish();
        let data = await this.send(buffer, sockName);

        let reply = this.ServerMessage.decode(data);
        if (reply.type !== this.ServerMessage.Type.SET_CONNECTIONS_RESPONSE)
            return this.error('Invalid reply from daemon');

        switch (reply.setConnectionsResponse.response) {
            case this.SetConnectionsResponse.Result.ACCEPTED:
                return;
            case this.SetConnectionsResponse.Result.REJECTED:
                return this.error('Request rejected');
            default:
                return this.error('Unsupported response from daemon');
        }
    }
}

module.exports = Load;
