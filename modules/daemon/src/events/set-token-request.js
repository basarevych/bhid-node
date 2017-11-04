/**
 * Set Token Request event
 * @module daemon/events/set-token-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Set Token Request event class
 */
class SetTokenRequest extends Base {
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
     * Service name is 'daemon.events.setTokenRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.setTokenRequest';
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
        return 'set_token_request';
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

        this._logger.debug('set-token-request', `Got SET TOKEN REQUEST`);
        try {
            let success = false;
            switch (message.setTokenRequest.type) {
                case this.daemon.SetTokenRequest.Type.MASTER:
                    success = await this.tracker.setMasterToken(message.setTokenRequest.trackerName, message.setTokenRequest.token);
                    break;
                case this.daemon.SetTokenRequest.Type.DAEMON:
                    success = await this.tracker.setDaemonToken(message.setTokenRequest.trackerName, message.setTokenRequest.token);
                    break
            }

            let reply = this.daemon.SetTokenResponse.create({
                response: success ? this.daemon.SetTokenResponse.Result.ACCEPTED : this.daemon.SetTokenResponse.Result.REJECTED,
            });
            let result = this.daemon.ServerMessage.create({
                type: this.daemon.ServerMessage.Type.SET_TOKEN_RESPONSE,
                setTokenResponse: reply,
            });
            let data = this.daemon.ServerMessage.encode(result).finish();
            this._logger.debug('set-token-request', `Sending SET TOKEN RESPONSE`);
            this.daemon.send(id, data);
        } catch (error) {
            this._logger.error(new NError(error, 'SetTokenRequest.handle()'));
        }
    }
}

module.exports = SetTokenRequest;
