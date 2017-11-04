/**
 * Tree Request event
 * @module daemon/events/tree-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Tree Request event class
 */
class TreeRequest extends Base {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     * @param {Logger} logger                   Logger service
     */
    constructor(app, config, logger) {
        super(app);
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'daemon.events.treeRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.treeRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger' ];
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'tree_request';
    }

    /**
     * Event handler
     * @param {string} id           ID of the client
     * @param {object} message      The message
     * @return {Promise}
     */
    async handle(id, message) {
        let client = this.daemon.clients.get(id);
        if (!client)
            return;

        this._logger.debug('tree-request', `Got TREE REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, tree) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('tree_response', onResponse);

                let reply = this.daemon.TreeResponse.create({
                    response: value,
                    tree: tree,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.TREE_RESPONSE,
                    treeResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('tree-request', `Sending TREE RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.treeRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.TreeResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.TreeResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('tree-request', `Got TREE RESPONSE from tracker`);
                reply(response.treeResponse.response, response.treeResponse.tree);
            };
            this.tracker.on('tree_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.TreeResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.TreeRequest.create({
                daemonName: message.treeRequest.daemonName,
                path: message.treeRequest.path,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.TREE_REQUEST,
                messageId: relayId,
                treeRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.treeRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'TreeRequest.handle()'));
        }
    }
}

module.exports = TreeRequest;
