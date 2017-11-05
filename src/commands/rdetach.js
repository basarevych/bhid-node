/**
 * Rdetach command
 * @module commands/rdetach
 */
const path = require('path');
const protobuf = require('protobufjs');
const argvParser = require('argv');
const Base = require('./base');

/**
 * Command class
 */
class Rdetach extends Base {
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
     * Service name is 'commands.rdetach'
     * @type {string}
     */
    static get provides() {
        return 'commands.rdetach';
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

        if (args.targets.length < 3)
            return this._help.helpRdetach(argv);

        let dpath = args.targets[1];
        let ddaemon = args.targets[2];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.RemoteDetachRequest = this.proto.lookup('local.RemoteDetachRequest');
                    this.RemoteDetachResponse = this.proto.lookup('local.RemoteDetachResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending REMOTE DETACH REQUEST');
            let request = this.RemoteDetachRequest.create({
                trackerName: trackerName,
                path: dpath,
                daemonName: ddaemon,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.REMOTE_DETACH_REQUEST,
                remoteDetachRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.REMOTE_DETACH_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.remoteDetachResponse.response) {
                case this.RemoteDetachResponse.Result.ACCEPTED:
                    return 0;
                case this.RemoteDetachResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.RemoteDetachResponse.Result.INVALID_PATH:
                    return this.error('Invalid path');
                case this.RemoteDetachResponse.Result.PATH_NOT_FOUND:
                    return this.error('Path not found');
                case this.RemoteDetachResponse.Result.DAEMON_NOT_FOUND:
                    return this.error('Path not found');
                case this.RemoteDetachResponse.Result.NOT_ATTACHED:
                    return this.error('Not attached');
                case this.RemoteDetachResponse.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case this.RemoteDetachResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            return this.error(error);
        }
    }
}

module.exports = Rdetach;
