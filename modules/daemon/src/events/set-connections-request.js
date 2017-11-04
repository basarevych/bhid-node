/**
 * Set Connections Request event
 * @module daemon/events/set-connections-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Set Connections Request event class
 */
class SetConnectionsRequest extends Base {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, connectionsList) {
        super(app);
        this._config = config;
        this._logger = logger;
        this._connectionsList = connectionsList;
    }

    /**
     * Service name is 'daemon.events.setConnectionsRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.setConnectionsRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'connectionsList' ];
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'set_connections_request';
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

        this._logger.debug('set-connections-request', `Got SET CONNECTIONS REQUEST`);
        try {
            let reply = value => {
                let reply = this.daemon.SetConnectionsResponse.create({
                    response: value,
                });
                let result = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.SET_CONNECTIONS_RESPONSE,
                    setConnectionsResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(result).finish();
                this._logger.debug('set-connections-request', `Sending SET CONNECTIONS RESPONSE`);
                this.daemon.send(id, data);
            };

            this._connectionsList.set(
                message.setConnectionsRequest.trackerName || this.tracker.default,
                message.setConnectionsRequest.list
            );

            if (this._connectionsList.save())
                reply(this.daemon.SetConnectionsResponse.Result.ACCEPTED);
            else
                reply(this.daemon.SetConnectionsResponse.Result.REJECTED);
        } catch (error) {
            this._logger.error(new NError(error, 'SetConnectionsRequest.handle()'));
        }
    }
}

module.exports = SetConnectionsRequest;
