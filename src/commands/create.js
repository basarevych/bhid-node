/**
 * Create command
 * @module commands/create
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');
const Base = require('./base');

/**
 * Command class
 */
class Create extends Base {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Help} help               Help command
     */
    constructor(app, config, help) {
        super(app);
        this._config = config;
        this._help = help;
    }

    /**
     * Service name is 'commands.create'
     * @type {string}
     */
    static get provides() {
        return 'commands.create';
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
    async run(argv) {
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
                name: 'client',
                short: 'c',
                type: 'boolean',
            })
            .option({
                name: 'encrypted',
                short: 'e',
                type: 'boolean',
            })
            .option({
                name: 'fixed',
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

        if (args.targets.length < 3)
            return this._help.helpCreate(argv);

        let cpath = args.targets[1];
        let first = args.targets[2];
        let second = args.targets[3] || '';
        let server = !!args.options.server;
        let client = !!args.options.client;
        let encrypted = !!args.options.encrypted;
        let fixed = !!args.options.fixed;
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        if (server && client)
            return this.error('Daemon cannot be a server and a client of the same connection at the same time');

        let firstAddress, firstPort;
        let match = /^\[(.+)\]:(.+)$/.exec(first);
        if (match) {
            firstAddress = match[1];
            firstPort = match[2];
        } else {
            let parts = first.split(':');
            if (parts.length === 2) {
                firstAddress = parts[0];
                firstPort = parts[1];
                if (!firstAddress || !firstPort || firstAddress === '*' || firstPort === '*')
                    return this.error('Invalid connect address');
            } else if (parts.length === 1 && parts[0].length && parts[0][0] === '/') {
                firstAddress = '';
                firstPort = parts[0];
            } else {
                return this.error('Invalid connect address');
            }
        }

        let secondAddress, secondPort;
        if (second) {
            let match = /^\[(.+)\]:(.+)$/.exec(second);
            if (match) {
                secondAddress = match[1];
                secondPort = match[2];
            } else {
                let parts = second.split(':');
                if (parts.length === 2) {
                    secondAddress = parts[0];
                    secondPort = parts[1];
                } else if (parts.length === 1 && parts[0].length && parts[0][0] === '/') {
                    secondAddress = '';
                    secondPort = parts[0];
                } else {
                    return this.error('Invalid listen address');
                }
            }
        } else {
            secondAddress = '';
            secondPort = '';
        }

        try {
            await this.init();

            let type;
            if (server)
                type = this.CreateRequest.Type.SERVER;
            else if (client)
                type = this.CreateRequest.Type.CLIENT;
            else
                type = this.CreateRequest.Type.NOT_CONNECTED;

            await this._app.debug('Sending CREATE REQUEST');
            let request = this.CreateRequest.create({
                trackerName: trackerName,
                path: cpath,
                type: type,
                encrypted: encrypted,
                fixed: fixed,
                connectAddress: firstAddress,
                connectPort: firstPort,
                listenAddress: secondAddress,
                listenPort: secondPort,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.CREATE_REQUEST,
                createRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.CREATE_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.createResponse.response) {
                case this.CreateResponse.Result.ACCEPTED:
                    await this._app.info(
                        'Server token: ' + reply.createResponse.serverToken + '\n' +
                        'Client token: ' + reply.createResponse.clientToken + '\n'
                    );
                    if (type !== this.CreateRequest.Type.NOT_CONNECTED)
                        await this._app.info('This daemon is configured as a ' + (client ? 'client' : 'server'));
                    if (type !== this.CreateRequest.Type.NOT_CONNECTED)
                        await this.updateConnections(trackerName, cpath, reply.createResponse.updates, sockName);
                    return 0;
                case this.CreateResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.CreateResponse.Result.INVALID_PATH:
                    return this.error('Invalid path');
                case this.CreateResponse.Result.PATH_EXISTS:
                    return this.error('Path exists');
                case this.CreateResponse.Result.INVALID_ADDRESS:
                    return this.error('Invalid address');
                case this.CreateResponse.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case this.CreateResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                case this.CreateResponse.Result.NOT_REGISTERED:
                    return this.error('Not registered with the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            await this.error(error);
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
                this.CreateRequest = this.proto.lookup('local.CreateRequest');
                this.CreateResponse = this.proto.lookup('local.CreateResponse');
                this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                this.UpdateConnectionsRequest = this.proto.lookup('local.UpdateConnectionsRequest');
                this.UpdateConnectionsResponse = this.proto.lookup('local.UpdateConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');
                resolve();
            });
        });
    }

    /**
     * Load the connection
     * @param {string} trackerName                      Name of the tracker
     * @param {string} acceptPath                       Check path of the list items
     * @param {object} [list]                           List of updated connections
     * @param {string} [sockName]                       Socket name
     * @return {Promise}
     */
    async updateConnections(trackerName, acceptPath, list, sockName) {
        if (!list)
            return;

        if (!this.proto)
            await this.init();

        let request = this.UpdateConnectionsRequest.create({
            trackerName: trackerName,
            list: list,
            path: acceptPath,
        });
        let message = this.ClientMessage.create({
            type: this.ClientMessage.Type.UPDATE_CONNECTIONS_REQUEST,
            updateConnectionsRequest: request,
        });
        let buffer = this.ClientMessage.encode(message).finish();
        let data = await this.send(buffer, sockName);

        let reply = this.ServerMessage.decode(data);
        if (reply.type !== this.ServerMessage.Type.UPDATE_CONNECTIONS_RESPONSE)
            return this.error('Invalid reply from daemon');

        switch (reply.updateConnectionsResponse.response) {
            case this.UpdateConnectionsResponse.Result.ACCEPTED:
                return;
            case this.UpdateConnectionsResponse.Result.REJECTED:
                return this.error('Could not start the connection');
            case this.UpdateConnectionsResponse.Result.NO_TRACKER:
                return this.error('Not connected to the tracker');
            case this.UpdateConnectionsResponse.Result.NOT_REGISTERED:
                return this.error('Not registered with the tracker');
            default:
                return this.error('Unsupported response from daemon');
        }
    }
}

module.exports = Create;
