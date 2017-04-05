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

/**
 * Command class
 */
class Redeem {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     * @param {Help} help               Help command
     */
    constructor(app, config, help) {
        this._app = app;
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
    run(argv) {
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
        let trackerName = args.options['tracker'] || '';
        let server = !!args.options['server'];
        let client = !!args.options['client'];
        let sockName = args.options['socket'];

        if (server && client)
            return this._help.helpRedeem(argv);
        if (!server && !client)
            client = true;

        let type, token;
        if (target.indexOf('@') !== -1)
            type = 'master';
        else if (target.indexOf('/') === -1)
            type = 'daemon';
        else
            type = 'path';

        if (type !== 'master') {
            try {
                token = fs.readFileSync(path.join(os.homedir(), '.bhid', 'master.token'), 'utf8').trim();
                if (!token)
                    throw new Error('No token');
            } catch (error) {
                return this.error('Master token not found');
            }
        }

        this._app.debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
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

                let reqClass, reqType, reqField, resClass, resType, resField, request;
                switch (type) {
                    case 'master':
                        this._app.debug(`Sending REDEEM MASTER REQUEST`);
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
                        this._app.debug(`Sending REDEEM DAEMON REQUEST`);
                        reqClass = this.RedeemDaemonRequest;
                        reqType = this.ClientMessage.Type.REDEEM_DAEMON_REQUEST;
                        reqField = 'redeemDaemonRequest';
                        resClass = this.RedeemDaemonResponse;
                        resType = this.ServerMessage.Type.REDEEM_DAEMON_RESPONSE;
                        resField = 'redeemDaemonResponse';
                        request = reqClass.create({
                            trackerName: trackerName,
                            token: token,
                            daemonName: target,
                        });
                        break;
                    case 'path':
                        this._app.debug(`Sending REDEEM PATH REQUEST`);
                        reqClass = this.RedeemPathRequest;
                        reqType = this.ClientMessage.Type.REDEEM_PATH_REQUEST;
                        reqField = 'redeemPathRequest';
                        resClass = this.RedeemPathResponse;
                        resType = this.ServerMessage.Type.REDEEM_PATH_RESPONSE;
                        resField = 'redeemPathResponse';
                        request = reqClass.create({
                            trackerName: trackerName,
                            token: token,
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
                this.send(buffer, sockName)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== resType)
                            throw new Error('Invalid reply from daemon');

                        switch (message[resField].response) {
                            case resClass.Result.ACCEPTED:
                                switch (type) {
                                    case 'master':
                                        return;
                                    case 'daemon':
                                        return this._app.info('Daemon token: ' + message[resField].token);
                                    case 'path':
                                        return this._app.info('Connection ' + (server ? 'server' : 'client') + ' token: ' + message[resField].token);
                                }
                                break;
                            case resClass.Result.REJECTED:
                                throw new Error('Request rejected');
                            case resClass.Result.TIMEOUT:
                                throw new Error('No response from the tracker');
                            case resClass.Result.NO_TRACKER:
                                throw new Error('Not connected to the tracker');
                            default:
                                throw new Error('Unsupported response from daemon');
                        }
                    })
                    .then(() => {
                        process.exit(0);
                    })
                    .catch(error => {
                        return this.error(error.message);
                    });
            } catch (error) {
                return this.error(error.message);
            }
        });

        return Promise.resolve();
    }

    /**
     * Send request and return response
     * @param {Buffer} request
     * @param {string} [sockName]
     * @return {Promise}
     */
    send(request, sockName) {
        return new Promise((resolve, reject) => {
            let sock;
            if (sockName && sockName[0] === '/')
                sock = sockName;
            else
                sock = path.join('/var', 'run', this._config.project, this._config.instance + (sockName || '') + '.sock');

            let onError = error => {
                this.error(`Could not connect to daemon: ${error.message}`);
            };

            let socket = net.connect(sock, () => {
                this._app.debug('Connected to daemon');
                socket.removeListener('error', onError);
                socket.once('error', error => { this.error(error.message) });

                let wrapper = new SocketWrapper(socket);
                wrapper.on('receive', data => {
                    this._app.debug('Got daemon reply');
                    resolve(data);
                    socket.end();
                });
                wrapper.send(request);
            });
            socket.on('error', onError);
        });
    }

    /**
     * Log error and terminate
     * @param {...*} args
     */
    error(...args) {
        return this._app.error(...args)
            .then(
                () => {
                    process.exit(1);
                },
                () => {
                    process.exit(1);
                }
            );
    }
}

module.exports = Redeem;