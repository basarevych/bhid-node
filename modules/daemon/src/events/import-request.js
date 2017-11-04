/**
 * Import Request event
 * @module daemon/events/import-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Import Request event class
 */
class ImportRequest extends Base {
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
     * Service name is 'daemon.events.importRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.importRequest';
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
        return 'import_request';
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

        this._logger.debug('import-request', `Got IMPORT REQUEST`);
        try {
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, updates) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('import_response', onResponse);

                let reply = this.daemon.ImportResponse.create({
                    response: value,
                    updates: updates,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.IMPORT_RESPONSE,
                    importResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('import-request', `Sending IMPORT RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.importRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.ImportResponse.Result.NO_TRACKER);
            if (!server.registered)
                return reply(this.daemon.ImportResponse.Result.NOT_REGISTERED);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('import-request', `Got IMPORT RESPONSE from tracker`);
                reply(
                    response.importResponse.response,
                    response.importResponse.updates
                );
            };
            this.tracker.on('import_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.ImportResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.ImportRequest.create({
                token: message.importRequest.token,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.IMPORT_REQUEST,
                messageId: relayId,
                importRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.importRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'ImportRequest.handle()'));
        }
    }
}

module.exports = ImportRequest;
