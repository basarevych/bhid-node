/**
 * Init command
 * @module commands/init
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
class Init extends Base {
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
     * Service name is 'commands.init'
     * @type {string}
     */
    static get provides() {
        return 'commands.init';
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
            return this._help.helpInit(argv);

        let email = args.targets[1];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.InitRequest = this.proto.lookup('local.InitRequest');
                    this.InitResponse = this.proto.lookup('local.InitResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending INIT REQUEST');
            let request = this.InitRequest.create({
                trackerName: trackerName,
                email: email,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.INIT_REQUEST,
                initRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.INIT_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.initResponse.response) {
                case this.InitResponse.Result.ACCEPTED:
                    return 0;
                case this.InitResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.InitResponse.Result.EMAIL_EXISTS:
                    return this.error('Account for this email already exists');
                case this.InitResponse.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case this.InitResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            return this.error(error);
        }
    }
}

module.exports = Init;
