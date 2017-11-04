/**
 * Delete command
 * @module commands/delete
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
class Delete extends Base {
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
     * Service name is 'commands.delete'
     * @type {string}
     */
    static get provides() {
        return 'commands.delete';
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
            return this._help.helpDelete(argv);

        let cpath = args.targets[1];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.DeleteRequest = this.proto.lookup('local.DeleteRequest');
                    this.DeleteResponse = this.proto.lookup('local.DeleteResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending DELETE REQUEST');
            let request = this.DeleteRequest.create({
                trackerName: trackerName,
                path: cpath,
            });
            let message = this.ClientMessage.create({
                type: this.ClientMessage.Type.DELETE_REQUEST,
                deleteRequest: request,
            });
            let buffer = this.ClientMessage.encode(message).finish();
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.DELETE_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.deleteResponse.response) {
                case this.DeleteResponse.Result.ACCEPTED:
                    return 0;
                case this.DeleteResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.DeleteResponse.Result.INVALID_PATH:
                    return this.error('Invalid path');
                case this.DeleteResponse.Result.PATH_NOT_FOUND:
                    return this.error('Path not found');
                case this.DeleteResponse.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case this.DeleteResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                case this.DeleteResponse.Result.NOT_REGISTERED:
                    return this.error('Not registered with the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            await this.error(error);
        }
    }
}

module.exports = Delete;
