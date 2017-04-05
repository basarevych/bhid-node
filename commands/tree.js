/**
 * Tree command
 * @module commands/disconnect
 */
const path = require('path');
const net = require('net');
const protobuf = require('protobufjs');
const archy = require('archy');
const argvParser = require('argv');
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
                name: 'daemon',
                short: 'd',
                type: 'string',
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

        let tpath = args.targets[1] || '';
        let daemonName = args.options['daemon'] || '';
        let trackerName = args.options['tracker'] || '';
        let sockName = args.options['socket'];

        this._app.debug('Loading protocol');
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

                this._app.debug(`Sending TREE REQUEST`);
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
                                let trees = [];
                                if (tpath.length) {
                                    trees.push(archy(this.buildTree(message.treeResponse.tree)).trim());
                                } else {
                                    for (let node of message.treeResponse.tree.tree)
                                        trees.push(archy(this.buildTree(node)).trim());
                                }
                                return this._app.info(trees.join('\n'));
                            case this.TreeResponse.Result.REJECTED:
                                throw new Error('Request rejected');
                            case this.TreeResponse.Result.INVALID_PATH:
                                throw new Error('Invalid path');
                            case this.TreeResponse.Result.PATH_NOT_FOUND:
                                throw new Error(tpath.length ? 'Path not found' : 'Empty tree');
                            case this.TreeResponse.Result.TIMEOUT:
                                throw new Error('No response from the tracker');
                            case this.TreeResponse.Result.NO_TRACKER:
                                throw new Error('Not connected to the tracker');
                            case this.TreeResponse.Result.NOT_REGISTERED:
                                throw new Error('Not registered with the tracker');
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
     * Build the tree
     * @param {object} tree                     The tree with subnodes
     * @return {object}
     */
    buildTree(tree) {
        let obj = {
            label: '/' + tree.name,
            nodes: [],
        };
        if (tree.connection) {
            obj.label += '\n' +
                (tree.type === this.Tree.Type.CLIENT ? '[' : '') +
                tree.clientsNumber +
                (tree.type === this.Tree.Type.CLIENT ? ']' : '') +
                ' on ' + (tree.listenAddress ?
                    tree.listenAddress + ':' :
                    ((tree.listenPort && tree.listenPort[0] === '/') ? '' : '*:')) +
                (tree.listenPort || '*') + ' --> ' +
                (tree.type === this.Tree.Type.SERVER ? '[' : '') +
                tree.serversNumber +
                (tree.type === this.Tree.Type.SERVER ? ']' : '') +
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

module.exports = Tree;