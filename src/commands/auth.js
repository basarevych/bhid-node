/**
 * Auth command
 * @module commands/auth
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
class Auth extends Base {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Help} help               Help command
     * @param {Load} load               Load command
     */
    constructor(app, config, help, load) {
        super(app);
        this._config = config;
        this._help = help;
        this._load = load;
    }

    /**
     * Service name is 'commands.auth'
     * @type {string}
     */
    static get provides() {
        return 'commands.auth';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'commands.help', 'commands.load' ];
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
                name: 'load',
                short: 'l',
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
            return this._help.helpAuth(argv);

        let token = args.targets[1];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            await this.auth(token, trackerName, sockName);
            if (args.options.load) {
                await this._load.init();
                await this._load.request(trackerName, sockName);
                await this._load.load(trackerName, list, sockName);
            }
            return 0;
        } catch (error) {
            await this.error(error);
        }
    }

    /**
     * Authenticate the daemon
     * @param {string} token
     * @param {string} [trackerName]
     * @param {string} [sockName]
     * @returns {Promise}
     */
    async auth(token, trackerName, sockName) {
        await this._app.debug('Loading protocol');
        await new Promise((resolve, reject) => {
            protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                if (error)
                    return reject(error);

                this.proto = root;
                this.SetTokenRequest = this.proto.lookup('local.SetTokenRequest');
                this.SetTokenResponse = this.proto.lookup('local.SetTokenResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');
                resolve();
            });
        });

        await this._app.debug('Sending SET TOKEN REQUEST');
        let request = this.SetTokenRequest.create({
            type: this.SetTokenRequest.Type.DAEMON,
            token: token,
            trackerName: trackerName,
        });
        let message = this.ClientMessage.create({
            type: this.ClientMessage.Type.SET_TOKEN_REQUEST,
            setTokenRequest: request,
        });
        let buffer = this.ClientMessage.encode(message).finish();
        let data = await this.send(buffer, sockName);

        let reply = this.ServerMessage.decode(data);
        if (reply.type !== this.ServerMessage.Type.SET_TOKEN_RESPONSE)
            return this.error('Invalid reply from daemon');

        switch (reply.setTokenResponse.response) {
            case this.SetTokenResponse.Result.ACCEPTED:
                return;
            case this.SetTokenResponse.Result.REJECTED:
                return this.error('Request rejected');
            default:
                return this.error('Unsupported response from daemon');
        }
    }
}

module.exports = Auth;
