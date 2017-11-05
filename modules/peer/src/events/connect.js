/**
 * Connect event
 * @module peer/events/connect
 */
const NError = require('nerror');
const Base = require('./base');

/**
 * Connect event class
 */
class Connect extends Base {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     * @param {Logger} logger                   Logger service
     * @param {Crypter} crypter                 Crypter service
     */
    constructor(app, config, logger, crypter) {
        super(app);
        this._config = config;
        this._logger = logger;
        this._crypter = crypter;
    }

    /**
     * Service name is 'peer.events.connect'
     * @type {string}
     */
    static get provides() {
        return 'peer.events.connect';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger', 'crypter' ];
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'connect';
    }

    /**
     * Event handler
     * @param {string} sessionId                Session ID
     * @return {Promise}
     */
    async handle(sessionId) {
        try {
            this.peer.sendConnectRequest(sessionId);
        } catch (error) {
            this._logger.error(new NError(error, `Connect.handle()`));
        }
    }
}

module.exports = Connect;
