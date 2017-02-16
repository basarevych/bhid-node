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
     * @param {App} app             The application
     * @param {object} config       Configuration
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
        return [ 'app', 'config' ];
    }

    /**
     * Bootstrap the module
     * @return {Promise}
     */
    bootstrap() {
        return Promise.resolve();
    }

    /**
     * Register with the server
     * @param {string} name                     Server name as in config
     * @return {Promise}
     */
    register(name) {
        if (this._config.get(`servers.${name}.class`) != 'servers.peer')
            return Promise.resolve();

        let tracker = this._app.get('servers').get('tracker');

        let registration = this._app.get('modules.peer.events.registration');
        tracker.on('registration', registration.handle.bind(registration));

        return Promise.resolve();
    }
}

module.exports = Peer;
