/**
 * Confirm command
 * @module commands/confirm
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
class Confirm extends Base {
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
     * Service name is 'commands.confirm'
     * @type {string}
     */
    static get provides() {
        return 'commands.confirm';
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
            return this._help.helpConfirm(argv);

        let token = args.targets[1];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.ConfirmRequest = this.proto.lookup('local.ConfirmRequest');
                    this.ConfirmResponse = this.proto.lookup('local.ConfirmResponse');
                    this.SetTokenRequest = this.proto.lookup('local.SetTokenRequest');
                    this.SetTokenResponse = this.proto.lookup('local.SetTokenResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending CONFIRM REQUEST');
            let request = this.ConfirmRequest.create({
                trackerName: trackerName,
                token: token,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.CONFIRM_REQUEST,
                confirmRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.CONFIRM_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.confirmResponse.response) {
                case this.ConfirmResponse.Result.ACCEPTED:
                    await this._app.debug('Sending SET TOKEN REQUEST');
                    request = this.SetTokenRequest.create({
                        type: this.SetTokenRequest.Type.MASTER,
                        token: reply.confirmResponse.token,
                        trackerName: trackerName,
                    });
                    message = this.ClientMessage.create({
                        type: this.ClientMessage.Type.SET_TOKEN_REQUEST,
                        setTokenRequest: request,
                    });
                    buffer = this.ClientMessage.encode(message).finish();
                    data = await this.send(buffer, sockName);

                    reply = this.ServerMessage.decode(data);
                    if (reply.type !== this.ServerMessage.Type.SET_TOKEN_RESPONSE)
                        return this.error('Invalid reply from daemon');

                    switch (reply.setTokenResponse.response) {
                        case this.SetTokenResponse.Result.ACCEPTED:
                            await this._app.info('New master token has been saved on this host and will be used automatically');
                            return 0;
                        case this.SetTokenResponse.Result.REJECTED:
                            return this.error('Set token request rejected');
                        default:
                            return this.error('Unsupported response from daemon');
                    }
                case this.ConfirmResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.ConfirmResponse.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case this.ConfirmResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            await this.error(error);
        }
    }
}

module.exports = Confirm;
