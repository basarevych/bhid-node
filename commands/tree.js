/**
 * Tree command
 * @module commands/disconnect
 */
const debug = require('debug')('bhid:command');
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const archy = require('archy');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class Tree {
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
     * Service name is 'commands.tree'
     * @type {string}
     */
    static get provides() {
        return 'commands.tree';
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
        let tpath = argv['_'][1] || '';
        let daemonName = argv['d'] || '';
        let trackerName = argv['t'] || '';

        debug('Loading protocol');
        protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
            if (error)
                return this.error(error.message);

            try {
                this.proto = root;
                this.Tree = this.proto.lookup('local.Tree');
                this.TreeRequest = this.proto.lookup('local.TreeRequest');
                this.TreeResponse = this.proto.lookup('local.TreeResponse');
                this.ClientMessage = this.proto.lookup('local.ClientMessage');
                this.ServerMessage = this.proto.lookup('local.ServerMessage');

                debug(`Sending TREE REQUEST`);
                let request = this.TreeRequest.create({
                    trackerName: trackerName,
                    daemonName: daemonName,
                    path: tpath,
                });
                let message = this.ClientMessage.create({
                    type: this.ClientMessage.Type.TREE_REQUEST,
                    treeRequest: request,
                });
                let buffer = this.ClientMessage.encode(message).finish();
                this.send(buffer)
                    .then(data => {
                        let message = this.ServerMessage.decode(data);
                        if (message.type !== this.ServerMessage.Type.TREE_RESPONSE)
                            throw new Error('Invalid reply from daemon');

                        switch (message.treeResponse.response) {
                            case this.TreeResponse.Result.ACCEPTED:
                                if (tpath.length) {
                                    process.stdout.write(archy(this.buildTree(message.treeResponse.tree)));
                                } else {
                                    for (let node of message.treeResponse.tree.tree)
                                        process.stdout.write(archy(this.buildTree(node)));
                                }
                                process.exit(0);
                                break;
                            case this.TreeResponse.Result.REJECTED:
                                console.log('Request rejected');
                                process.exit(1);
                                break;
                            case this.TreeResponse.Result.INVALID_PATH:
                                console.log('Invalid path');
                                process.exit(1);
                                break;
                            case this.TreeResponse.Result.PATH_NOT_FOUND:
                                console.log(tpath.length ? 'Path not found' : 'Empty tree');
                                process.exit(1);
                                break;
                            case this.TreeResponse.Result.TIMEOUT:
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
     * Build the tree
     * @param {object} tree                     The tree with subnodes
     */
    buildTree(tree) {
        let obj = {
            label: '/' + tree.name,
            nodes: [],
        };
        if (tree.connection) {
            obj.label += '\n' +
                '[' + (tree.type == this.Tree.Type.CLIENT ? '*' : ' ') + '] Client token: ' + tree.clientToken +
                '\n' +
                '[' + (tree.type == this.Tree.Type.SERVER ? '*' : ' ') + '] Server token: ' + tree.serverToken;
        } else {
            obj.label += '\n' + 'Client token: ' + tree.clientToken;
        }
        for (let node of tree.tree)
            obj.nodes.push(this.buildTree(node));
        return obj;
    }

    /**
     * Indent a text
     * @param {number} length                   Number of spaces
     * @return {string}
     */
    _indent(length) {
        let result = '';
        for (let i = 0; i < length; i++)
            result += ' ';
        return result;
    }

    /**
     * Send request and return response
     * @param {Buffer} request
     * @return {Promise}
     */
    send(request) {
        return new Promise((resolve, reject) => {
            let sock = path.join('/var', 'run', this._config.project, this._config.instance + '.sock');
            let socket = net.connect(sock, () => {
                debug('Connected to daemon');
                wrapper.send(request);
            });
            let wrapper = new SocketWrapper(socket);
            wrapper.on('receive', data => {
                debug('Got daemon reply');
                socket.end();
                resolve(data);
            });
            socket.on('error', error => { this.error(error); });
            socket.on('close', () => { reject(new Error('Socket terminated')); });
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

module.exports = Tree;