/**
 * Attach command
 * @module commands/attach
 */
const path = require('path');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const Base = require('./base');

/**
 * Command class
 */
class Attach extends Base {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Help} help               Help command
     * @param {Create} create           Create command
     */
    constructor(app, config, help, create) {
        super(app);
        this._config = config;
        this._help = help;
        this._create = create;
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
        return [ 'app', 'config', 'commands.help', 'commands.create' ];
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
            return this._help.helpAttach(argv);

        let apath = args.targets[1];
        let override = args.targets[2] || '';
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            let overrideAddress, overridePort;
            if (override) {
                let match = /^\[(.+)\]:(.+)$/.exec(override);
                if (match) {
                    overrideAddress = match[1];
                    overridePort = match[2];
                } else {
                    let parts = override.split(':');
                    if (parts.length === 2) {
                        overrideAddress = parts[0];
                        overridePort = parts[1];
                    } else if (parts.length === 1 && parts[0].length && parts[0][0] === '/') {
                        overrideAddress = '';
                        overridePort = parts[0];
                    } else {
                        return this.error('Invalid override address');
                    }
                }
            } else {
                overrideAddress = '';
                overridePort = '';
            }

            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.AttachRequest = this.proto.lookup('local.AttachRequest');
                    this.AttachResponse = this.proto.lookup('local.AttachResponse');
                    this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                    this.UpdateConnectionsRequest = this.proto.lookup('local.UpdateConnectionsRequest');
                    this.UpdateConnectionsResponse = this.proto.lookup('local.UpdateConnectionsResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending ATTACH REQUEST');
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
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.ATTACH_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.attachResponse.response) {
                case this.AttachResponse.Result.ACCEPTED:
                    await this._create.updateConnections(trackerName, apath, reply.attachResponse.updates, sockName);
                    return 0;
                case this.AttachResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.AttachResponse.Result.INVALID_PATH:
                    return this.error('Invalid path');
                case this.AttachResponse.Result.PATH_NOT_FOUND:
                    return this.error('Path not found');
                case this.AttachResponse.Result.INVALID_ADDRESS:
                    return this.error('Invalid address');
                case this.AttachResponse.Result.ALREADY_ATTACHED:
                    return this.error('Already attached');
                case this.AttachResponse.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case this.AttachResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                case this.AttachResponse.Result.NOT_REGISTERED:
                    return this.error('Not registered with the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            await this.error(error);
        }
    }
}

module.exports = Attach;
