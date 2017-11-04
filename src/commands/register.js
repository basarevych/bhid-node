/**
 * Register command
 * @module commands/register
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
class Register extends Base {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Help} help               Help command
     * @param {Auth} auth               Auth command
     */
    constructor(app, config, help, auth) {
        super(app);
        this._config = config;
        this._help = help;
        this._auth = auth;
    }

    /**
     * Service name is 'commands.register'
     * @type {string}
     */
    static get provides() {
        return 'commands.register';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'commands.help', 'commands.auth' ];
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
                name: 'randomize',
                short: 'r',
                type: 'boolean',
            })
            .option({
                name: 'authenticate',
                short: 'a',
                type: 'boolean',
            })
            .option({
                name: 'quiet',
                short: 'q',
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

        let daemonName = args.targets[1] || '';
        let randomize = daemonName ? !!args.options.randomize : true;
        let authenticate = !!args.options.authenticate;
        let quiet = !!args.options.quiet;
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.CreateDaemonRequest = this.proto.lookup('local.CreateDaemonRequest');
                    this.CreateDaemonResponse = this.proto.lookup('local.CreateDaemonResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending CREATE DAEMON REQUEST');
            let request = this.CreateDaemonRequest.create({
                trackerName: trackerName,
                daemonName: daemonName,
                randomize: randomize,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.CREATE_DAEMON_REQUEST,
                createDaemonRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.CREATE_DAEMON_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.createDaemonResponse.response) {
                case this.CreateDaemonResponse.Result.ACCEPTED:
                    if (authenticate) {
                        await this._auth.auth(reply.createDaemonResponse.token, trackerName, sockName);
                    } else if (quiet) {
                        await this._app.info(reply.createDaemonResponse.token);
                    } else {
                        await this._app.info(
                            'Name: ' + reply.createDaemonResponse.daemonName + '\n' +
                            'Token: ' + reply.createDaemonResponse.token
                        );
                    }
                    return 0;
                case this.CreateDaemonResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.CreateDaemonResponse.Result.INVALID_NAME:
                    return this.error('Invalid name');
                case this.CreateDaemonResponse.Result.NAME_EXISTS:
                    return this.error('Daemon with this name already exists');
                case this.CreateDaemonResponse.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case this.CreateDaemonResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            return this.error(error);
        }
    }
}

module.exports = Register;
