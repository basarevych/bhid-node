/**
 * Tree command
 * @module commands/disconnect
 */
const path = require('path');
const protobuf = require('protobufjs');
const archy = require('archy');
const argvParser = require('argv');
const Base = require('./base');

/**
 * Command class
 */
class Tree extends Base {
    /**
     * Create the service
     * @param {App} app                 The application
     * @param {object} config           Configuration
     */
    constructor(app, config) {
        super(app);
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
        return ['app', 'config'];
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
        let daemonName = args.options.daemon || '';
        let trackerName = args.options.tracker || '';
        let sockName = args.options.socket;

        try {
            await this._app.debug('Loading protocol');
            await new Promise((resolve, reject) => {
                protobuf.load(path.join(this._config.base_path, 'proto', 'local.proto'), (error, root) => {
                    if (error)
                        return reject(error);

                    this.proto = root;
                    this.Tree = this.proto.lookup('local.Tree');
                    this.TreeRequest = this.proto.lookup('local.TreeRequest');
                    this.TreeResponse = this.proto.lookup('local.TreeResponse');
                    this.ClientMessage = this.proto.lookup('local.ClientMessage');
                    this.ServerMessage = this.proto.lookup('local.ServerMessage');
                    resolve();
                });
            });

            await this._app.debug('Sending TREE REQUEST');
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
            let data = await this.send(buffer, sockName);

            let reply = this.ServerMessage.decode(data);
            if (reply.type !== this.ServerMessage.Type.TREE_RESPONSE)
                return this.error('Invalid reply from daemon');

            switch (reply.treeResponse.response) {
                case this.TreeResponse.Result.ACCEPTED:
                    let trees = [];
                    if (tpath.length) {
                        trees.push(archy(this.buildTree(reply.treeResponse.tree)).trim());
                    } else {
                        for (let node of reply.treeResponse.tree.tree)
                            trees.push(archy(this.buildTree(node)).trim());
                    }
                    await this._app.info(trees.join('\n'));
                    return 0;
                case this.TreeResponse.Result.REJECTED:
                    return this.error('Request rejected');
                case this.TreeResponse.Result.INVALID_PATH:
                    return this.error('Invalid path');
                case this.TreeResponse.Result.PATH_NOT_FOUND:
                    return this.error(tpath.length ? 'Path not found' : 'Empty tree');
                case this.TreeResponse.Result.TIMEOUT:
                    return this.error('No response from the tracker');
                case this.TreeResponse.Result.NO_TRACKER:
                    return this.error('Not connected to the tracker');
                case this.TreeResponse.Result.NOT_REGISTERED:
                    return this.error('Not registered with the tracker');
                default:
                    return this.error('Unsupported response from daemon');
            }
        } catch (error) {
            return this.error(error);
        }
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
                (tree.type === this.Tree.Type.SERVER ? '[*] ' : '[ ] ') +
                tree.serversNumber + ' server(s) defined for ' +
                (tree.connectAddress
                    ? tree.connectAddress + ':'
                    : '') + tree.connectPort;
            obj.label += '\n' +
                (tree.type === this.Tree.Type.CLIENT ? '[*] ' : '[ ] ') +
                tree.clientsNumber + ' client(s) defined on ' +
                (tree.listenAddress
                    ? tree.listenAddress + ':'
                    : ((tree.listenPort && tree.listenPort[0] === '/') ? '' : '*:')) +
                (tree.listenPort || '*');

            let props = [];
            if (tree.encrypted)
                props.push('encrypted');
            if (tree.fixed)
                props.push('fixed');
            if (props.length)
                obj.label += '\nConnection is ' + props.join(', ');
        }
        for (let node of tree.tree)
            obj.nodes.push(this.buildTree(node));
        return obj;
    }
}

module.exports = Tree;
