/**
 * Front module
 * @module front/module
 */

/**
 * Module main class
 */
class Front {
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
     * Service name is 'modules.front'
     * @type {string}
     */
    static get provides() {
        return 'modules.front';
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
}

module.exports = Front;
