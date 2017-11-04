/**
 * Daemon module
 * @module daemon/module
 */
const path = require('path');

/**
 * Module main class
 */
class Daemon {
    /**
     * Create the module
     * @param {App} app                                             The application
     * @param {object} config                                       Configuration
     * @param {Logger} logger                                       Logger service
     */
    constructor(app, config, logger)
    {
        this._app = app;
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'modules.daemon'
     * @type {string}
     */
    static get provides() {
        return 'modules.daemon';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [
            'app',
            'config',
            'logger',
        ];
    }

    /**
     * Register with the server
     * @param {object} server                                       Server instance
     * @return {Promise}
     */
    async register(server) {
        if (server.constructor.provides !== 'servers.daemon')
            return;

        this.events = this._app.get(/^daemon\.events\..+$/);
        for (let event of this.events.values())
            server.on(event.name, event.handle.bind(event));
    }
}

module.exports = Daemon;
