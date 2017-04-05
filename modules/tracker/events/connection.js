/**
 * Connection event
 * @module tracker/events/connection
 */
const uuid = require('uuid');
const WError = require('verror').WError;

/**
 * Connection event class
 */
class Connection {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     * @param {Logger} logger                   Logger service
     * @param {Crypter} crypter                 Crypter service
     */
    constructor(app, config, logger, crypter) {
        this._app = app;
        this._config = config;
        this._logger = logger;
        this._crypter = crypter;
    }

    /**
     * Service name is 'modules.tracker.events.connection'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker.events.connection';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'crypter' ];
    }

    /**
     * Event handler
     * @param {string} name                     Name of the tracker
     */
    handle(name) {
        let server = this.tracker.servers.get(name);
        if (!server || !server.token)
            return;

        this._logger.debug('connection', `${name} connected - registering`);
        try {
            let msgId = uuid.v1();

            let onResponse = (name, response) => {
                if (response.messageId != msgId)
                    return;

                this.tracker.removeListener('register_daemon_response', onResponse);

                this._logger.debug('connection', `Got REGISTER DAEMON RESPONSE from tracker`);
                switch (response.registerDaemonResponse.response) {
                    case this.tracker.RegisterDaemonResponse.Result.ACCEPTED:
                        server.registered = true;
                        server.email = response.registerDaemonResponse.email;
                        server.daemonName = response.registerDaemonResponse.name;
                        this.tracker.emit('registration', name);
                        break;
                    case this.tracker.RegisterDaemonResponse.Result.REJECTED:
                        this.tracker._logger.error(`Tracker ${name} refused to register this daemon`);
                        break;
                    default:
                        this._logger.debug('connection', 'Unsupported response from daemon');
                }
            };
            this.tracker.on('register_daemon_response', onResponse);

            let request = this.tracker.RegisterDaemonRequest.create({
                token: server.token,
                identity: this._crypter.identity,
                key: this.peer.publicKey,
            });
            let msg = this.tracker.ClientMessage.create({
                type: this.tracker.ClientMessage.Type.REGISTER_DAEMON_REQUEST,
                messageId: msgId,
                registerDaemonRequest: request,
            });
            let data = this.tracker.ClientMessage.encode(msg).finish();
            this.tracker.send(name, data);
        } catch (error) {
            this._logger.error(new WError(error, 'Connection.handle()'));
        }
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

    /**
     * Retrieve peer server
     * @return {Peer}
     */
    get peer() {
        if (this._peer)
            return this._peer;
        this._peer = this._app.get('servers').get('peer');
        return this._peer;
    }
}

module.exports = Connection;