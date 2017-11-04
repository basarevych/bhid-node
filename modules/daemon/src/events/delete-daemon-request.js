/**
 * Delete Daemon Request event
 * @module daemon/events/delete-daemon-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Delete Daemon Request event class
 */
class DeleteDaemonRequest extends Base {
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
     * Service name is 'daemon.events.deleteDaemonRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.deleteDaemonRequest';
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
        return 'delete_daemon_request';
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

        this._logger.debug('delete-daemon-request', `Got DELETE DAEMON REQUEST`);
        try {
            let masterToken = await this.tracker.getMasterToken(message.deleteDaemonRequest.trackerName);
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = value => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('delete_daemon_response', onResponse);

                let reply = this.daemon.DeleteDaemonResponse.create({
                    response: value,
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.DELETE_DAEMON_RESPONSE,
                    deleteDaemonResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('delete-daemon-request', `Sending DELETE DAEMON RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.deleteDaemonRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.DeleteDaemonResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('delete-daemon-request', `Got DELETE DAEMON RESPONSE from tracker`);
                reply(response.deleteDaemonResponse.response);
            };
            this.tracker.on('delete_daemon_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.DeleteDaemonResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.DeleteDaemonRequest.create({
                token: masterToken,
                daemonName: message.deleteDaemonRequest.daemonName,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.DELETE_DAEMON_REQUEST,
                messageId: relayId,
                deleteDaemonRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.deleteDaemonRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'DeleteDaemonRequest.handle()'));
        }
    }
}

module.exports = DeleteDaemonRequest;
