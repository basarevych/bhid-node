/**
 * Set Token Request event
 * @module daemon/events/set-token-request
 */
const debug = require('debug')('bhid:daemon');
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Set Token Request event class
 */
class SetTokenRequest {
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
     * Service name is 'modules.daemon.events.setTokenRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.setTokenRequest';
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

        debug(`Got SET TOKEN REQUEST`);
        try {
            let reply = value => {
                let reply = this.daemon.SetTokenResponse.create({
                    response: value,
                });
                let result = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.SET_TOKEN_RESPONSE,
                    setTokenResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(result).finish();
                debug(`Sending SET TOKEN RESPONSE`);
                this.daemon.send(id, data);
            };

            if (this.tracker.setToken(message.setTokenRequest.trackerName, message.setTokenRequest.token))
                reply(this.daemon.SetTokenResponse.Result.ACCEPTED);
            else
                reply(this.daemon.SetTokenResponse.Result.REJECTED);
        } catch (error) {
            this._logger.error(new WError(error, 'SetTokenRequest.handle()'));
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

module.exports = SetTokenRequest;