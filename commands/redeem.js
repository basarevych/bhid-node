/**
 * Redeem command
 * @module commands/redeem
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Redeem {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     */
    constructor(app, config) {
        this._app = app;
        this._config = config;
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
        return [ 'app', 'config' ];
    }

    /**
     * Run the command
     * @param {object} argv             Minimist object
     * @return {Promise}
     */
    run(argv) {
        if (argv['_'].length < 2)
            return this.error('Invalid parameters');

        let trackerName = argv['t'] || '';
        let server = argv['s'] || false;
        let client = argv['c'] || false;

        if (server && client)
            return this.error('Invalid parameters');
        if (!server && !client)
            client = true;

        let email, token, target;
        if (argv['_'].length == 2) {
            email = argv['_'][1];
        } else {
            token = argv['_'][1];
            target = argv['_'][2];
        }

        let type;
        if (email)
            type = 'master';
        else if (target.indexOf('/') == -1)
            type = 'daemon';
        else
            type = 'path';

        debug('Loading protocol');
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
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                let reqClass, reqType, reqField, resClass, resType, resField, request;
                switch (type) {
                    case 'master':
                        debug(`Sending REDEEM MASTER REQUEST`);
                        reqClass = this.RedeemMasterRequest;
                        reqType = this.ClientMessage.Type.REDEEM_MASTER_REQUEST;
                        reqField = 'redeemMasterRequest';
                        resClass = this.RedeemMasterResponse;
                        resType = this.ServerMessage.Type.REDEEM_MASTER_RESPONSE;
                        resField = 'redeemMasterResponse';
                        request = reqClass.create({
                            trackerName: trackerName,
                            email: email,
                        });
                        break;
                    case 'daemon':
                        debug(`Sending REDEEM DAEMON REQUEST`);
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
                        debug(`Sending REDEEM PATH REQUEST`);
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
                            type: server ? reqClass.Type.Server: reqClass.Type.CLIENT,
                        });
                        break;
                }

                let message = this.ClientMessage.create({
                    type: reqType,
                    [reqField]: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== resType)
                            throw new Error('Invalid reply from daemon');

                        switch (message[resField].response) {
                            case resClass.Result.ACCEPTED:
                                switch (type) {
                                    case 'master':
                                        break;
                                    case 'daemon':
                                        console.log('Token: ' + message[resField].token);
                                        break;
                                    case 'path':
                                        console.log('Token: ' + message[resField].token);
                                        break;
                                }
                                process.exit(0);
                                break;
                            case resClass.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case resClass.Result.TIMEOUT:
                                console.log('No response from the tracker');
                                process.exit(1);
                                break;
                            case resClass.Result.NO_TRACKER:
                                console.log('Not connected to the tracker');
                                process.exit(1);
                                break;
                            default:
                                throw new Error('Unsupported response from daemon');
                        }
                    })
                    .catch(error => {
                        this.error(error.message);
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
     * @return {Promise}
     */
    send(request) {
        return new Promise((resolve, reject) => {
            let sock = path.join('/var', 'run', this._config.project, this._config.instance + '.sock');
            let attempts = 0;
            let connect = () => {
                if (++attempts > 10)
                    return reject(new Error('Could not connect to daemon'));

                let connected = false;
                let socket = net.connect(sock, () => {
                    debug('Connected to daemon');
                    connected = true;
                    socket.once('error', error => { this.error(error.message) });

                    let wrapper = new SocketWrapper(socket);
                    wrapper.on('receive', data => {
                        debug('Got daemon reply');
                        resolve(data);
                        socket.end();
                    });
                    wrapper.send(request);
                });
                socket.once('close', () => {
                    if (connected)
                        reject(new Error('Socket terminated'));
                    else
                        setTimeout(() => { connect(); }, 500);
                });
            };
            connect();
        });
    }

    /**
     * Log error and terminate
     * @param {...*} args
     */
    error(...args) {
        console.error(...args);
        process.exit(1);
    }
}

module.exports = Redeem;