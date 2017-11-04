/**
 * Remote Detach Request event
 * @module daemon/events/remote-detach-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Remote Detach Request event class
 */
class RemoteDetachRequest extends Base {
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
     * Service name is 'daemon.events.remoteDetachRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.remoteDetachRequest';
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
        return 'remote_detach_request';
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

        this._logger.debug('remote-detach-request', `Got REMOTE DETACH REQUEST`);
        try {
            let masterToken = await this.tracker.getMasterToken(message.remoteDetachRequest.trackerName);
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = value => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('remote_detach_response', onResponse);

                let reply = this.daemon.RemoteDetachResponse.create({
                    response: value,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.REMOTE_DETACH_RESPONSE,
                    remoteDetachResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('remote-detach-request', `Sending REMOTE DETACH RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.remoteDetachRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.RemoteDetachResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('remote-detach-request', `Got REMOTE DETACH RESPONSE from tracker`);
                reply(response.remoteDetachResponse.response);
            };
            this.tracker.on('remote_detach_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.RemoteDetachResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.RemoteDetachRequest.create({
                token: masterToken,
                path: message.remoteDetachRequest.path,
                daemonName: message.remoteDetachRequest.daemonName,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.REMOTE_DETACH_REQUEST,
                messageId: relayId,
                remoteDetachRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.remoteDetachRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'RemoteDetachRequest.handle()'));
        }
    }
}

module.exports = RemoteDetachRequest;
