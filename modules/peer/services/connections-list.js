/**
 * Connections list
 * @module peer/services/connections-list
 */
const debug = require('debug')('bhid:connections-list');
const path = require('path');
const fs = require('fs');
const ini = require('ini');
const WError = require('verror').WError;

class ConnectionsList {
    /**
     * Create service
     * @param {App} app                     Application
     * @param {object} config               Configuration
     * @param {Logger} logger               Logger service
     */
    constructor(app, config, logger) {
        this._list = new Map();
        this._app = app;
        this._config = config;
        this._logger = logger;
    }

    /**
     * Service name is 'modules.peer.connectionsList'
     * @type {string}
     */
    static get provides() {
        return 'modules.peer.connectionsList';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger' ];
    }

    /**
     * This service is a singleton
     */
    static get lifecycle() {
        return 'singleton';
    }

    /**
     * Server section delimiter in config
     */
    static get serverSection() {
        return ':server';
    }

    /**
     * Client section delimiter in config
     */
    static get clientSection() {
        return ':client';
    }

    /**
     * Load connections list
     */
    load() {
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

            this._list.clear();
            let bhidConfig = ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));
            for (let section of Object.keys(bhidConfig)) {
                if (section.endsWith(this.constructor.serverSection)) {
                    let tracker = bhidConfig[section]['tracker'];
                    if (!tracker)
                        continue;
                    let conf = this._list.get(tracker);
                    if (!conf) {
                        conf = { serverConnections: [], clientConnections: [] };
                        this._list.set(tracker, conf);
                    }
                    let connection = {
                        name: section.substr(0, section.length - this.constructor.serverSection.length),
                        connectAddress: bhidConfig[section]['connect_address'],
                        connectPort: bhidConfig[section]['connect_port'],
                        encrypted: bhidConfig[section]['encrypted'] == 'yes',
                        fixed: bhidConfig[section]['fixed'] == 'yes',
                        clients: bhidConfig[section]['clients'],
                    };
                    conf.serverConnections.push(connection);
                } else if (section.endsWith(this.constructor.clientSection)) {
                    let tracker = bhidConfig[section]['tracker'];
                    if (!tracker)
                        continue;
                    let conf = this._list.get(tracker);
                    if (!conf) {
                        conf = { serverConnections: [], clientConnections: [] };
                        this._list.set(tracker, conf);
                    }
                    let connection = {
                        name: section.substr(0, section.length - this.constructor.clientSection.length),
                        listenAddress: bhidConfig[section]['listen_address'],
                        listenPort: bhidConfig[section]['listen_port'],
                        encrypted: bhidConfig[section]['encrypted'] == 'yes',
                        server: bhidConfig[section]['server'],
                    };
                    conf.clientConnections.push(connection);
                }
            }
        } catch (error) {
            this._logger.error(new WError(error, 'ConnectionsList.load()'));
        }
    }

    /**
     * Set connections list
     * @param {string} trackerName          Tracker name
     * @param {object} list                 Connections list
     */
    set(trackerName, list) {
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
            let output = {};
            for (let section of Object.keys(bhidConfig)) {
                if (!section.endsWith(this.constructor.serverSection) &&
                    !section.endsWith(this.constructor.clientSection))
                {
                    output[section] = bhidConfig[section];
                }
            }

            for (let connection of list.serverConnections) {
                output[connection.name + this.constructor.serverSection] = {
                    tracker: trackerName,
                    connect_address: connection.connectAddress,
                    connect_port: connection.connectPort,
                    encrypted: connection.encrypted ? 'yes' : 'no',
                    fixed: connection.fixed ? 'yes' : 'no',
                    clients: connection.clients,
                };
            }
            for (let connection of list.clientConnections) {
                output[connection.name + this.constructor.clientSection] = {
                    tracker: trackerName,
                    listen_address: connection.listenAddress,
                    listen_port: connection.listenPort,
                    encrypted: connection.encrypted ? 'yes' : 'no',
                    server: connection.server,
                };
            }

            fs.writeFileSync(path.join(configPath, 'bhid.conf'), ini.stringify(output));
        } catch (error) {
            this._logger.error(new WError(error, 'ConnectionsList.set()'));
            return false;
        }

        this._list.set(trackerName, list);
        return true;
    }
}

module.exports = ConnectionsList;
