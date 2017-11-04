/**
 * Daemons List Request event
 * @module daemon/events/daemons-list-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Daemons List Request event class
 */
class DaemonsListRequest extends Base {
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
     * Service name is 'daemon.events.daemonsListRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.daemonsListRequest';
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
        return 'daemons_list_request';
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

        this._logger.debug('daemons-list-request', `Got DAEMONS LIST REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, list) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('daemons_list_response', onResponse);

                let reply = this.daemon.DaemonsListResponse.create({
                    response: value,
                    list: list,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.DAEMONS_LIST_RESPONSE,
                    daemonsListResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('daemons-list-request', `Sending DAEMONS LIST RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.daemonsListRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.DaemonsListResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.DaemonsListResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('daemons-list-request', `Got DAEMONS LIST RESPONSE from tracker`);
                reply(response.daemonsListResponse.response, response.daemonsListResponse.list);
            };
            this.tracker.on('daemons_list_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.DaemonsListResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.DaemonsListRequest.create({
                path: message.daemonsListRequest.path,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.DAEMONS_LIST_REQUEST,
                messageId: relayId,
                daemonsListRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.daemonsListRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'DaemonsListRequest.handle()'));
        }
    }
}

module.exports = DaemonsListRequest;
