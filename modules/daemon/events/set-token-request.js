/**
 * Set Token Request event
 * @module daemon/events/set-token-request
 */
const uuid = require('uuid');
const NError = require('nerror');

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

        this._logger.debug('set-token-request', `Got SET TOKEN REQUEST`);
        return Promise.resolve()
            .then(() => {
                switch (message.setTokenRequest.type) {
                    case this.daemon.SetTokenRequest.Type.MASTER:
                        return this.tracker.setMasterToken(message.setTokenRequest.token);
                    case this.daemon.SetTokenRequest.Type.DAEMON:
                        return this.tracker.setDaemonToken(message.setTokenRequest.trackerName, message.setTokenRequest.token);
                }

                return false;
            })
            .then(success => {
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
            })
            .catch (error => {
                this._logger.error(new NError(error, 'SetTokenRequest.handle()'));
            });
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