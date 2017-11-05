/**
 * Import command
 * @module commands/import
 */
const path = require('path');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const Base = require('./base');

/**
 * Command class
 */
class Import extends Base {
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
    async run(argv) {
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

        try {
            await this.init();

            await this._app.debug('Sending IMPORT REQUEST');
            let request = this.ImportRequest.create({
                trackerName: trackerName,
                token: token,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.IMPORT_REQUEST,
                importRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.IMPORT_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.importResponse.response) {
                case this.ImportResponse.Result.ACCEPTED:
                    await this.importConnections(trackerName, token, reply.importResponse.updates, sockName);
                    return 0;
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
                this.ImportRequest = this.proto.lookup('local.ImportRequest');
                this.ImportResponse = this.proto.lookup('local.ImportResponse');
                this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                this.ImportConnectionsRequest = this.proto.lookup('local.ImportConnectionsRequest');
                this.ImportConnectionsResponse = this.proto.lookup('local.ImportConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');
                resolve();
            });
        });
    }

    /**
     * import the connection
     * @param {string} trackerName                      Name of the tracker
     * @param {string} token                            The token
     * @param {object} [list]                           List of updated connections
     * @param {string} [sockName]                       Socket name
     * @return {Promise}
     */
    async importConnections(trackerName, token, list, sockName) {
        if (!list)
            return;

        if (!this.proto)
            await this.init();

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
        let data = await this.send(buffer, sockName);

        let reply = this.ServerMessage.decode(data);
        if (reply.type !== this.ServerMessage.Type.IMPORT_CONNECTIONS_RESPONSE)
            return this.error('Invalid reply from daemon');

        switch (reply.importConnectionsResponse.response) {
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
    }
}

module.exports = Import;
