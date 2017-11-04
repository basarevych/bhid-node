/**
 * Init Request event
 * @module daemon/events/init-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Init Request event class
 */
class InitRequest extends Base {
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
     * Service name is 'daemon.events.initRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.initRequest';
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
        return 'init_request';
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

        this._logger.debug('init-request', `Got INIT REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = value => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('init_response', onResponse);

                let reply = this.daemon.InitResponse.create({
                    response: value,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.INIT_RESPONSE,
                    initResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('init-request', `Sending INIT RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.initRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.InitResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('init-request', `Got INIT RESPONSE from tracker`);
                reply(response.initResponse.response);
            };
            this.tracker.on('init_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.InitResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.InitRequest.create({
                email: message.initRequest.email,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.INIT_REQUEST,
                messageId: relayId,
                initRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.initRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'InitRequest.handle()'));
        }
    }
}

module.exports = InitRequest;
