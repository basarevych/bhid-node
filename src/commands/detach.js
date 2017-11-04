/**
 * Detach command
 * @module commands/detach
 */
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');
const Base = require('./base');

/**
 * Command class
 */
class Detach extends Base {
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
     * Service name is 'commands.detach'
     * @type {string}
     */
    static get provides() {
        return 'commands.detach';
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
            return this._help.helpDetach(argv);

        let dpath = args.targets[1];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.DetachRequest = this.proto.lookup('local.DetachRequest');
                    this.DetachResponse = this.proto.lookup('local.DetachResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending DETACH REQUEST');
            let request = this.DetachRequest.create({
                trackerName: trackerName,
                path: dpath,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.DETACH_REQUEST,
                detachRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.DETACH_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.detachResponse.response) {
                case this.DetachResponse.Result.ACCEPTED:
                    return 0;
                case this.DetachResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.DetachResponse.Result.INVALID_PATH:
                    return this.error('Invalid path');
                case this.DetachResponse.Result.PATH_NOT_FOUND:
                    return this.error('Path not found');
                case this.DetachResponse.Result.NOT_ATTACHED:
                    return this.error('Not attached');
                case this.DetachResponse.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case this.DetachResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                case this.DetachResponse.Result.NOT_REGISTERED:
                    return this.error('Not registered with the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            await this.error(error);
        }
    }
}

module.exports = Detach;
