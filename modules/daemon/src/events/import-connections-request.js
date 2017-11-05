/**
 * Import Connections Request event
 * @module daemon/events/import-connections-request
 */
const NError = require('nerror');
const Base = require('./base');

/**
 * Import Connections Request event class
 */
class ImportConnectionsRequest extends Base {
    /**
     * Create service
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     * @param {Logger} logger                       Logger service
     * @param {ConnectionsList} connectionsList     Connections List service
     */
    constructor(app, config, logger, connectionsList) {
        super(app);
        this._config = config;
        this._logger = logger;
        this._connectionsList = connectionsList;
    }

    /**
     * Service name is 'daemon.events.importConnectionsRequest'
     * @type {string}
     */
    static get provides() {
        return 'daemon.events.importConnectionsRequest';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'connectionsList' ];
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'import_connections_request';
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

        this._logger.debug('import-connections-request', `Got IMPORT CONNECTIONS REQUEST`);
        try {
            let reply = value => {
                let reply = this.daemon.ImportConnectionsResponse.create({
                    response: value,
                });
                let result = this.daemon.ServerMessage.create({
                    type: this.daemon.ServerMessage.Type.IMPORT_CONNECTIONS_RESPONSE,
                    importConnectionsResponse: reply,
                });
                let data = this.daemon.ServerMessage.encode(result).finish();
                this._logger.debug('import-connections-request', `Sending IMPORT CONNECTIONS RESPONSE`);
                this.daemon.send(id, data);
            };

            this._connectionsList.import(
                message.importConnectionsRequest.trackerName || this.tracker.default,
                message.importConnectionsRequest.token,
                message.importConnectionsRequest.list
            );

            reply(this.daemon.ImportConnectionsResponse.Result.ACCEPTED);
        } catch (error) {
            this._logger.error(new NError(error, 'UpdateConnectionsRequest.handle()'));
        }
    }
}

module.exports = ImportConnectionsRequest;
