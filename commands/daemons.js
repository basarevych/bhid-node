/**
 * Daemons command
 * @module commands/daemons
 */
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const read = require('read');
const argvParser = require('argv');
const SocketWrapper = require('socket-wrapper');
const Table = require('easy-table');

/**
 * Command class
 */
class Daemons {
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
     * Service name is 'commands.daemons'
     * @type {string}
     */
    static get provides() {
        return 'commands.daemons';
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

        let search = args.targets.length && args.targets[1];
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        this._app.debug('Loading protocol').catch(() => { /* do nothing */ });
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error);

            try {
                this.proto = root;
                this.Daemon = this.proto.lookup('local.Daemon');
                this.DaemonsListRequest = this.proto.lookup('local.DaemonsListRequest');
                this.DaemonsListResponse = this.proto.lookup('local.DaemonsListResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                this._app.debug('Sending DAEMONS LIST REQUEST').catch(() => { /* do nothing */ });
                let request = this.DaemonsListRequest.create({
                    trackerName: trackerName,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.DAEMONS_LIST_REQUEST,
                    daemonsListRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer, sockName)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.DAEMONS_LIST_RESPONSE)
                            return this.error('Invalid reply from daemon');

                        switch (message.daemonsListResponse.response) {
                            case this.DaemonsListResponse.Result.ACCEPTED:
                                return this.printTable(message.daemonsListResponse.list, search || undefined);
                            case this.DaemonsListResponse.Result.REJECTED:
                                return this.error('Request rejected');
                            case this.DaemonsListResponse.Result.NO_TRACKER:
                                return this.error('Not connected to the tracker');
                            case this.DaemonsListResponse.Result.NOT_REGISTERED:
                                return this.error('Not registered with the tracker');
                            default:
                                return this.error('Unsupported response from daemon');
                        }
                    })
                    .then(() => {
                        process.exit(0);
                    })
                    .catch(error => {
                        return this.error(error);
                    });
            } catch (error) {
                return this.error(error);
            }
        });

        return Promise.resolve();
    }

    /**
     * Print the table
     * @param {object} list
     * @param {string} [search]
     */
    printTable(list, search) {
        if (!list.length)
            return this._app.info('No daemons registered');

        let table = new Table();
        list.forEach(row => {
            if (search && search !== row.name)
                return;

            table.cell('Name', row.name);
            table.cell('Status', row.online ? 'online' : 'offline');
            table.cell('Version', row.version);
            table.cell('Hostname', row.hostname);
            table.cell('External IP', row.externalAddress);
            table.cell('Internal IP', row.internalAddresses.length ? row.internalAddresses[0] : '');
            table.newRow();
            for (let i = 1; i < row.internalAddresses.length; i++) {
                table.cell('Name', '');
                table.cell('Status', '');
                table.cell('Version', '');
                table.cell('Hostname', '');
                table.cell('External IP', '');
                table.cell('Internal IP', row.internalAddresses[i]);
                table.newRow();
            }
        });
        return this._app.info(table.toString().trim());
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
            if (sockName && sockName[0] === '/') {
                sock = sockName;
            } else {
                sockName = sockName ? `.${sockName}` : '';
                sock = path.join('/var', 'run', this._config.project, this._config.instance + sockName + '.sock');
            }

            let onError = error => {
                this.error(`Could not connect to daemon: ${error.message}`);
            };

            let socket = net.connect(sock, () => {
                this._app.debug('Connected to daemon').catch(() => { /* do nothing */ });
                socket.removeListener('error', onError);
                socket.once('error', error => { this.error(error); });

                let wrapper = new SocketWrapper(socket);
                wrapper.on('receive', data => {
                    this._app.debug('Got daemon reply').catch(() => { /* do nothing */ });
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
        return args.reduce(
                (prev, cur) => {
                    return prev.then(() => {
                        return this._app.error(cur.fullStack || cur.stack || cur.message || cur);
                    });
                },
                Promise.resolve()
            )
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

module.exports = Daemons;
