/**
 * Tracker module
 * @module peer/module
 */


/**
 * Module main class
 */
class Peer {
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
     * Service name is 'modules.peer'
     * @type {string}
     */
    static get provides() {
        return 'modules.peer';
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
        if (server.constructor.provides !== 'servers.peer')
            return;

        this.events = this._app.get(/^peer\.events\..+$/);
        for (let event of this.events.values())
            server.on(event.name, event.handle.bind(event));
    }
}

module.exports = Peer;
