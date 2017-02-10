/**
 * Confirm Response message
 * @module tracker/messages/confirm-response
 */
const debug = require('debug')('bhid:tracker');
const path = require('path');
const fs = require('fs');
const ini = require('ini');
const WError = require('verror').WError;

/**
 * Confirm Response message class
 */
class ConfirmResponse {
    /**
     * Create service
     * @param {App} app                         The application
     * @param {object} config                   Configuration
     */
    constructor(app, config) {
        this._app = app;
        this._config = config;
    }

    /**
     * Service name is 'modules.tracker.messages.confirmResponse'
     * @type {string}
     */
    static get provides() {
        return 'modules.tracker.messages.confirmResponse';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config' ];
    }

    /**
     * Message handler
     * @param {string} name         Name of the tracker
     * @param {object} message      The message
     */
    onMessage(name, message) {
        if (message.confirmResponse.response != this.tracker.ConfirmResponse.Result.ACCEPTED)
            return;

        let server = this.tracker.servers.get(name);
        if (!server)
            return;

        debug(`Got CONFIRM RESPONSE`);
        server.token = message.confirmResponse.token;
        try {
            let configPath;
            for (let candidate of [ '/etc/bhid', '/usr/local/etc/bhid' ]) {
                try {
                    fs.accessSync(path.join(candidate, 'bhid.conf'), fs.constants.F_OK);
                    configPath = candidate;
                    break;
                } catch (error) {
                    // do nothing
                }
            }

            if (!configPath)
                throw new Error('Could not read bhid.conf');

            let bhidConfig = ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));
            for (let section of Object.keys(bhidConfig)) {
                if (!section.endsWith(this.tracker.constructor.trackerSection))
                    continue;

                let tracker = section.substr(0, section.length - this.tracker.constructor.trackerSection.length);
                if (tracker == name) {
                    bhidConfig[section]['token'] = server.token;
                    break;
                }
            }

            fs.writeFileSync(path.join(configPath, 'bhid.conf'), ini.stringify(bhidConfig));
        } catch (error) {
            this._tracker._logger.error(new WError(error, 'ConfirmResponse.onMessage()'));
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
}

module.exports = ConfirmResponse;