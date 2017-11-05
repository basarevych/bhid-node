/**
 * Daemons command
 * @module commands/daemons
 */
const path = require('path');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const Table = require('easy-table');
const Base = require('./base');

/**
 * Command class
 */
class Daemons extends Base {
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
     * Service name is 'commands.daemons'
     * @type {string}
     */
    static get provides() {
        return 'commands.daemons';
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
                    this.Daemon = this.proto.lookup('local.Daemon');
                    this.DaemonsListRequest = this.proto.lookup('local.DaemonsListRequest');
                    this.DaemonsListResponse = this.proto.lookup('local.DaemonsListResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending DAEMONS LIST REQUEST');
            let request = this.DaemonsListRequest.create({
                trackerName: trackerName,
                path: search || '',
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.DAEMONS_LIST_REQUEST,
                daemonsListRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.DAEMONS_LIST_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.daemonsListResponse.response) {
                case this.DaemonsListResponse.Result.ACCEPTED:
                    await this.printTable(reply.daemonsListResponse.list, !noHeader, search);
                    return 0;
                case this.DaemonsListResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.DaemonsListResponse.Result.INVALID_PATH:
                    return this.error('Invalid path');
                case this.DaemonsListResponse.Result.PATH_NOT_FOUND:
                    return this.error('Path not found');
                case this.DaemonsListResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                case this.DaemonsListResponse.Result.NOT_REGISTERED:
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
     * @param {object} list
     * @param {boolean} printHeader
     * @param {string} [search]
     * @return {Promise}
     */
    async printTable(list, printHeader, search) {
        if (!list.length)
            return this._app.info('No daemons registered');

        let table = new Table();
        list.forEach(row => {
            let parts = row.name.split('?');
            if (search) {
                table.cell('Type', row.server ? 'server' : (row.client ? 'client' : ''));
                table.cell('User', parts.length > 1 ? parts[0] : '');
            }
            table.cell('Name', parts.length > 1 ? parts[1] : parts[0]);
            table.cell('Status', row.online ? 'online' : 'offline');
            table.cell('Version', row.version);
            table.cell('Hostname', row.hostname);
            table.cell('External IP', row.externalAddress);
            table.cell('Internal IP', row.internalAddresses.length ? row.internalAddresses[0] : '');
            table.newRow();
            for (let i = 1; i < row.internalAddresses.length; i++) {
                if (search) {
                    table.cell('Type', '');
                    table.cell('User', '');
                }
                table.cell('Name', '');
                table.cell('Status', '');
                table.cell('Version', '');
                table.cell('Hostname', '');
                table.cell('External IP', '');
                table.cell('Internal IP', row.internalAddresses[i]);
                table.newRow();
            }
        });

        let result = table.toString().trim();
        if (printHeader)
            return this._app.info(result);

        return this._app.info(result.split('\n').splice(2).join('\n'));
    }
}

module.exports = Daemons;
