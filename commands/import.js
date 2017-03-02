/**
 * Import command
 * @module commands/import
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Import {
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
     * Service name is 'commands.import'
     * @type {string}
     */
    static get provides() {
        return 'commands.import';
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
     * @param {object} argv             Minimist object
     * @return {Promise}
     */
    run(argv) {
        if (argv['_'].length < 2)
            return this._help.helpImport(argv);

        let token = argv['_'][1];
        let trackerName = argv['t'] || '';

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.ImportRequest = this.proto.lookup('local.ImportRequest');
                this.ImportResponse = this.proto.lookup('local.ImportResponse');
                this.ConnectionsList = this.proto.lookup('local.ConnectionsList');
                this.ImportConnectionsRequest = this.proto.lookup('local.ImportConnectionsRequest');
                this.ImportConnectionsResponse = this.proto.lookup('local.ImportConnectionsResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending IMPORT REQUEST`);
                let request = this.ImportRequest.create({
                    trackerName: trackerName,
                    token: token,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.IMPORT_REQUEST,
                    importRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.IMPORT_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.importResponse.response) {
                            case this.ImportResponse.Result.ACCEPTED:
                                this.import(trackerName, token, message.connectResponse.updates);
                                break;
                            case this.ImportResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.ImportResponse.Result.ALREADY_CONNECTED:
                                console.log('Already connected');
                                process.exit(1);
                                break;
                            case this.ImportResponse.Result.TIMEOUT:
                                console.log('No response from the tracker');
                                process.exit(1);
                                break;
                            case this.ImportResponse.Result.NO_TRACKER:
                                console.log('Not connected to the tracker');
                                process.exit(1);
                                break;
                            case this.ImportResponse.Result.NOT_REGISTERED:
                                console.log('Not registered with the tracker');
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
     * import the connection
     * @param {string} trackerName                      Name of the tracker
     * @param {string} token                            The token
     * @param {object} [list]                           List of updated connections
     */
    import(trackerName, token, list) {
        if (!list)
            process.exit(0);

        let request = this.ImportConnectionsRequest.create({
            trackerName: trackerName,
            token: token,
            list: list,
        });
        let message = this.ClientMessage.create({
            type: this.ClientMessage.Type.IMPORT_CONNECTIONS_REQUEST,
            importConnectionsRequest: request,
        });
        let buffer = this.ClientMessage.encode(message).finish();
        this.send(buffer)
            .then(data => {
                let message = this.ServerMessage.decode(data);
                if (message.type !== this.ServerMessage.Type.IMPORT_CONNECTIONS_RESPONSE)
                    throw new Error('Invalid reply from daemon');

                switch (message.importConnectionsResponse.response) {
                    case this.ImportConnectionsResponse.Result.ACCEPTED:
                        for (let connection of list.serverConnections)
                            console.log(`Server of ${connection.name}`);
                        for (let connection of list.clientConnections)
                            console.log(`Client of ${connection.name}`);
                        process.exit(0);
                        break;
                    case this.ImportConnectionsResponse.Result.REJECTED:
                        console.log('Could not import the connections');
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

module.exports = Import;