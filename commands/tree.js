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
        let sockName = argv['z'];

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
                this.send(buffer, sockName)
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
                                console.log('No response from the tracker');
                                process.exit(1);
                                break;
                            case this.TreeResponse.Result.NO_TRACKER:
                                console.log('Not connected to the tracker');
                                process.exit(1);
                                break;
                            case this.TreeResponse.Result.NOT_REGISTERED:
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
                (tree.type == this.Tree.Type.CLIENT ? '[' : '') +
                tree.clientsNumber +
                (tree.type == this.Tree.Type.CLIENT ? ']' : '') +
                ' on ' + (tree.listenAddress ?
                    tree.listenAddress + ':' :
                    ((tree.listenPort && tree.listenPort[0] == '/') ? '' : '*:')) +
                tree.listenPort || '*' + ' -> ' +
                (tree.type == this.Tree.Type.SERVER ? '[' : '') +
                tree.serversNumber +
                (tree.type == this.Tree.Type.SERVER ? ']' : '') +
                ' on ' + (tree.connectAddress ? tree.connectAddress + ':' : '') + tree.connectPort +
                (tree.encrypted ? ', encrypted' : '') +
                (tree.fixed ? ', fixed' : '');
        }
        for (let node of tree.tree)
            obj.nodes.push(this.buildTree(node));
        return obj;
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
            if (sockName && sockName[0] == '/')
                sock = sockName;
            else
                sock = path.join('/var', 'run', this._config.project, this._config.instance + (sockName || '') + '.sock');

            let onError = error => {
                this.error(`Could not connect to daemon: ${error.message}`);
            };

            let socket = net.connect(sock, () => {
                debug('Connected to daemon');
                socket.removeListener('error', onError);
                socket.once('error', error => { this.error(error.message) });

                let wrapper = new SocketWrapper(socket);
                wrapper.on('receive', data => {
                    debug('Got daemon reply');
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
        console.error(...args);
        process.exit(1);
    }
}

module.exports = Tree;