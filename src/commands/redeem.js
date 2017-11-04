/**
 * Redeem command
 * @module commands/redeem
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
class Redeem extends Base {
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
     * Service name is 'commands.redeem'
     * @type {string}
     */
    static get provides() {
        return 'commands.redeem';
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
            return this._help.helpRedeem(argv);

        let target = args.targets[1];
        let trackerName = args.options.tracker || '';
        let server = !!args.options.server;
        let client = !!args.options.client;
        let sockName = args.options.socket;

        if (server && client)
            return this._help.helpRedeem(argv);
        if (!server && !client)
            client = true;

        let type;
        if (target.includes('@'))
            type = 'master';
        else if (target.includes('/'))
            type = 'path';
        else
            type = 'daemon';

        try {
            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.RedeemMasterRequest = this.proto.lookup('local.RedeemMasterRequest');
                    this.RedeemMasterResponse = this.proto.lookup('local.RedeemMasterResponse');
                    this.RedeemDaemonRequest = this.proto.lookup('local.RedeemDaemonRequest');
                    this.RedeemDaemonResponse = this.proto.lookup('local.RedeemDaemonResponse');
                    this.RedeemPathRequest = this.proto.lookup('local.RedeemPathRequest');
                    this.RedeemPathResponse = this.proto.lookup('local.RedeemPathResponse');
                    this.SetTokenRequest = this.proto.lookup('local.SetTokenRequest');
                    this.SetTokenResponse = this.proto.lookup('local.SetTokenResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            let reqClass, reqType, reqField, resClass, resType, resField, request;
            switch (type) {
                case 'master':
                    await this._app.debug('Sending REDEEM MASTER REQUEST');
                    reqClass = this.RedeemMasterRequest;
                    reqType = this.ClientMessage.Type.REDEEM_MASTER_REQUEST;
                    reqField = 'redeemMasterRequest';
                    resClass = this.RedeemMasterResponse;
                    resType = this.ServerMessage.Type.REDEEM_MASTER_RESPONSE;
                    resField = 'redeemMasterResponse';
                    request = reqClass.create({
                        trackerName: trackerName,
                        email: target,
                    });
                    break;
                case 'daemon':
                    await this._app.debug('Sending REDEEM DAEMON REQUEST');
                    reqClass = this.RedeemDaemonRequest;
                    reqType = this.ClientMessage.Type.REDEEM_DAEMON_REQUEST;
                    reqField = 'redeemDaemonRequest';
                    resClass = this.RedeemDaemonResponse;
                    resType = this.ServerMessage.Type.REDEEM_DAEMON_RESPONSE;
                    resField = 'redeemDaemonResponse';
                    request = reqClass.create({
                        trackerName: trackerName,
                        daemonName: target,
                    });
                    break;
                case 'path':
                    await this._app.debug('Sending REDEEM PATH REQUEST');
                    reqClass = this.RedeemPathRequest;
                    reqType = this.ClientMessage.Type.REDEEM_PATH_REQUEST;
                    reqField = 'redeemPathRequest';
                    resClass = this.RedeemPathResponse;
                    resType = this.ServerMessage.Type.REDEEM_PATH_RESPONSE;
                    resField = 'redeemPathResponse';
                    request = reqClass.create({
                        trackerName: trackerName,
                        path: target,
                        type: server ? reqClass.Type.SERVER : reqClass.Type.CLIENT,
                    });
                    break;
            }

            let message = this.ClientMessage.create({
                type: reqType,
                [reqField]: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== resType)
                return this.error('Invalid reply from daemon');

            switch (reply[resField].response) {
                case resClass.Result.ACCEPTED:
                    switch (type) {
                        case 'daemon':
                            await this._app.info('Daemon token: ' + reply[resField].token);
                            break;
                        case 'path':
                            await this._app.info('Connection ' + (server ? 'server' : 'client') + ' token: ' + reply[resField].token);
                            break;
                    }
                    return 0;
                case resClass.Result.REJECTED:
                    return this.error('Request rejected');
                case resClass.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case resClass.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            return this.error(error);
        }
    }
}

module.exports = Redeem;
