/**
 * Load command
 * @module commands/disconnect
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const read = require('read');
const SocketWrapper = require('socket-wrapper');
const Table = require('easy-table');

/**
 * Command class
 */
class Load {
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
     * Service name is 'commands.load'
     * @type {string}
     */
    static get provides() {
        return 'commands.load';
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
        let trackerName = argv['t'] || '';
        let quiet = argv['q'] || false;

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.ConnectionsListRequest = this.proto.lookup('local.ConnectionsListRequest');
                this.ConnectionsListResponse = this.proto.lookup('local.ConnectionsListResponse');
                this.SetConnectionsRequest = this.proto.lookup('local.SetConnectionsRequest');
                this.SetConnectionsResponse = this.proto.lookup('local.SetConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending CONNECTION LIST REQUEST`);
                let request = this.ConnectionsListRequest.create({
                    trackerName: trackerName,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.CONNECTIONS_LIST_REQUEST,
                    connectionsListRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.CONNECTIONS_LIST_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.connectionsListResponse.response) {
                            case this.ConnectionsListResponse.Result.ACCEPTED:
                                if (quiet) {
                                    this.load(trackerName, message.connectionsListResponse.list);
                                } else {
                                    this.printTable(message.connectionsListResponse.list);
                                    read({prompt: '\nAccept? (yes/no): '}, (error, answer) => {
                                        if (error)
                                            return this.error(error.message);

                                        if (answer.toLowerCase() == 'yes' || answer.toLowerCase() == 'y')
                                            this.load(trackerName, message.connectionsListResponse.list);
                                        else
                                            process.exit(0);
                                    });
                                }
                                break;
                            case this.ConnectionsListResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.ConnectionsListResponse.Result.TIMEOUT:
                                console.log('No response from tracker');
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
     * Print the table
     * @param {object} list
     */
    printTable(list) {
        if (!list.serverConnections.length && !list.clientConnections.length)
            return console.log('No connections defined');

        let table = new Table();
        list.serverConnections.forEach(row => {
            table.cell('Name', row.name);
            table.cell('Type', 'server');
            table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
            table.cell('Fixed', row.fixed ? 'yes' : 'no');
            table.cell('Address', row.connectAddress);
            table.cell('Port', row.connectPort);
            table.cell('Peers', row.clients.length ? row.clients.join(', ') : '');
            table.newRow();
        });
        list.clientConnections.forEach(row => {
            table.cell('Name', row.name);
            table.cell('Type', 'client');
            table.cell('Encrypted', row.encrypted ? 'yes' : 'no');
            table.cell('Fixed', '');
            table.cell('Address', row.listenAddress);
            table.cell('Port', row.listenPort);
            table.cell('Peers', row.server);
            table.newRow();
        });
        console.log(table.toString().trim() + '\n');
    }

    /**
     * Load the list
     * @param {string} trackerName                      Name of the tracker
     * @param {object} list                             List as in the protocol
     */
    load(trackerName, list) {
        let request = this.SetConnectionsRequest.create({
            trackerName: trackerName,
            list: list,
        });
        let message = this.ClientMessage.create({
            type: this.ClientMessage.Type.SET_CONNECTIONS_REQUEST,
            setConnectionsRequest: request,
        });
        let buffer = this.ClientMessage.encode(message).finish();
        this.send(buffer)
            .then(data => {
                let message = this.ServerMessage.decode(data);
                if (message.type !== this.ServerMessage.Type.SET_CONNECTIONS_RESPONSE)
                    throw new Error('Invalid reply from daemon');

                switch (message.setConnectionsResponse.response) {
                    case this.SetConnectionsResponse.Result.ACCEPTED:
                        process.exit(0);
                        break;
                    case this.SetConnectionsResponse.Result.REJECTED:
                        console.log('Request rejected');
                        process.exit(1);
                        break;
                    default:
                        throw new Error('Unsupported response from daemon');
                }
            })
            .catch(error => {
                this.error(error.message);
            });
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

module.exports = Load;