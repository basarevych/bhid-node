/**
 * Create Daemon Request event
 * @module daemon/events/create-daemon-request
 */
const uuid = require('uuid');
const NError = require('nerror');
const Base = require('./base');

/**
 * Create Daemon Request event class
 */
class CreateDaemonRequest extends Base {
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
     * Service name is 'daemon.events.createDaemonRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.createDaemonRequest';
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
        return 'create_daemon_request';
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

        this._logger.debug('create-daemon-request', `Got CREATE DAEMON REQUEST`);
        try {
            let masterToken = await this.tracker.getMasterToken(message.createDaemonRequest.trackerName);
            let relayId = uuid.v1();

            let timer, onResponse;
            let reply = (value, name, token) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                if (onResponse)
                    this.tracker.removeListener('create_daemon_response', onResponse);

                let reply = this.daemon.CreateDaemonResponse.create({
                    response: value,
                    daemonName: name || '',
                    token: token || '',
                });
                let relay = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.CREATE_DAEMON_RESPONSE,
                    createDaemonResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(relay).finish();
                this._logger.debug('create-daemon-request', `Sending CREATE DAEMON RESPONSE`);
                this.daemon.send(id, data);
            };

            let server = this.tracker.getServer(message.createDaemonRequest.trackerName);
            if (!server || !server.connected)
                return reply(this.daemon.CreateDaemonResponse.Result.NO_TRACKER);

            onResponse = (name, response) => {
                if (response.messageId !== relayId)
                    return;

                this._logger.debug('create-daemon-request', `Got CREATE DAEMON RESPONSE from tracker`);
                reply(
                    response.createDaemonResponse.response,
                    response.createDaemonResponse.daemonName,
                    response.createDaemonResponse.token
                );
            };
            this.tracker.on('create_daemon_response', onResponse);

            timer = setTimeout(
                () => reply(this.daemon.CreateDaemonResponse.Result.TIMEOUT),
                this.daemon.constructor.requestTimeout
            );

            let request = this.tracker.CreateDaemonRequest.create({
                token: masterToken,
                daemonName: message.createDaemonRequest.daemonName,
                randomize: message.createDaemonRequest.randomize,
            });
            let relay = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.CREATE_DAEMON_REQUEST,
                messageId: relayId,
                createDaemonRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(relay).finish();
            this.tracker.send(message.createDaemonRequest.trackerName, data);
        } catch (error) {
            this._logger.error(new NError(error, 'CreateDaemonRequest.handle()'));
        }
    }
}

module.exports = CreateDaemonRequest;
