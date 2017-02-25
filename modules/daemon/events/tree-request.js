/**
 * Tree Request event
 * @module daemon/events/tree-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Tree Request event class
 */
class TreeRequest {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     * @param {Logger} logger                   Logger service
     */
    constructor(app, config, logger) {
        this._app = app;
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'modules.daemon.events.treeRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.treeRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger' ];
    }

    /**
     * Event handler
     * @param {string} id           ID of the client
     * @param {object} message      The message
     */
    handle(id, message) {
        let client = this.daemon.clients.get(id);
        if (!client)
            return;

        debug(`Got TREE REQUEST`);
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
                debug(`Sending TREE RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.treeRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.TreeResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.TreeResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId != relayId)
                    return;

                debug(`Got TREE RESPONSE from tracker`);
                reply(response.treeResponse.response, response.treeResponse.tree);
            };
            this.tracker.on('tree_response', onResponse);

            timer = setTimeout(
                () => {
                    reply(this.daemon.TreeResponse.Result.TIMEOUT);
                },
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
            this._logger.error(new WError(error, 'TreeRequest.handle()'));
        }
    }

    /**
     * Retrieve daemon server
     * @return {Daemon}
     */
    get daemon() {
        if (this._daemon)
            return this._daemon;
        this._daemon = this._app.get('servers').get('daemon');
        return this._daemon;
    }

    /**
     * Retrieve tracker server
     * @return {Tracker}
     */
    get tracker() {
        if (this._tracker)
            return this._tracker;
        this._tracker = this._app.get('servers').get('tracker');
        return this._tracker;
    }
}

module.exports = TreeRequest;