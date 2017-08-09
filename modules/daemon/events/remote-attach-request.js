/**
 * Remote Attach Request event
 * @module daemon/events/remote-attach-request
 */
const uuid = require('uuid');
const NError = require('nerror');

/**
 * Remote Attach Request event class
 */
class RemoteAttachRequest {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     */
    constructor(app, config, logger) {
        this._app = app;
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'modules.daemon.events.remoteAttachRequest'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon.events.remoteAttachRequest';
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

        this._logger.debug('remote-attach-request', `Got REMOTE ATTACH REQUEST`);
        this.tracker.getMasterToken(message.remoteAttachRequest.trackerName)
            .then(masterToken => {
                let relayId = uuid.v1();

                let timer, onResponse;
                let reply = value => {
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }

                    if (onResponse)
                        this.tracker.removeListener('remote_attach_response', onResponse);

                    let reply = this.daemon.RemoteAttachResponse.create({
                        response: value,
                    });
                    let relay = this.daemon.ServerMessage.create({
                        type: this.daemon.ServerMessage.Type.REMOTE_ATTACH_RESPONSE,
                        remoteAttachResponse: reply,
                    });
                    let data = this.daemon.ServerMessage.encode(relay).finish();
                    this._logger.debug('remote-attach-request', `Sending REMOTE ATTACH RESPONSE`);
                    this.daemon.send(id, data);
                };

                let server = this.tracker.getServer(message.remoteAttachRequest.trackerName);
                if (!server || !server.connected)
                    return reply(this.daemon.RemoteAttachResponse.Result.NO_TRACKER);

                onResponse = (name, response) => {
                    if (response.messageId !== relayId)
                        return;

                    this._logger.debug('remote-attach-request', `Got REMOTE ATTACH RESPONSE from tracker`);
                    reply(response.remoteAttachResponse.response);
                };
                this.tracker.on('remote_attach_response', onResponse);

                timer = setTimeout(
                    () => {
                        reply(this.daemon.RemoteAttachResponse.Result.TIMEOUT);
                    },
                    this.daemon.constructor.requestTimeout
                );

                let request = this.tracker.RemoteAttachRequest.create({
                    token: masterToken,
                    path: message.remoteAttachRequest.path,
                    daemonName: message.remoteAttachRequest.daemonName,
                    server: message.remoteAttachRequest.server,
                    addressOverride: message.remoteAttachRequest.addressOverride,
                    portOverride: message.remoteAttachRequest.portOverride,
                });
                let relay = this.tracker.ClientMessage.create({
                    type: this.tracker.ClientMessage.Type.REMOTE_ATTACH_REQUEST,
                    messageId: relayId,
                    remoteAttachRequest: request,
                });
                let data = this.tracker.ClientMessage.encode(relay).finish();
                this.tracker.send(message.remoteAttachRequest.trackerName, data);
            })
            .catch(error => {
                this._logger.error(new NError(error, 'RemoteAttachRequest.handle()'));
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

module.exports = RemoteAttachRequest;