/**
 * Tracker module
 * @module tracker/module
 */

/**
 * Module main class
 */
class Tracker {
    /**
     * Create the module
     * @param {App} app                             The application
     * @param {object} config                       Configuration
     */
    constructor(app, config) {
        this._app = app;
        this._config = config;
    }

    /**
     * Service name is 'modules.tracker'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [
            'app',
            'config',
        ];
    }

    /**
     * Register with the server
     * @param {object} server                                       Server instance
     * @return {Promise}
     */
    async register(server) {
        if (server.constructor.provides !== 'servers.tracker')
            return;

        this.events = this._app.get(/^tracker\.events\..+$/);
        for (let event of this.events.values())
            server.on(event.name, event.handle.bind(event));
    }
}

module.exports = Tracker;
