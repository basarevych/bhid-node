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
        this.list = new Map();

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

            this.list.clear();
            let bhidConfig = ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));
            let openedConnections = new Set();
            for (let section of Object.keys(bhidConfig)) {
                if (section.endsWith(this.constructor.serverSection)) {
                    let tracker = section.split('#')[0];
                    if (!tracker)
                        continue;
                    let conf = this.list.get(tracker);
                    if (!conf) {
                        conf = { serverConnections: new Map(), clientConnections: new Map() };
                        this.list.set(tracker, conf);
                    }
                    let connection = {
                        name: section.substring(tracker.length + 1, section.length - this.constructor.serverSection.length),
                        connectAddress: bhidConfig[section]['connect_address'],
                        connectPort: bhidConfig[section]['connect_port'],
                        encrypted: bhidConfig[section]['encrypted'] == 'yes',
                        fixed: bhidConfig[section]['fixed'] == 'yes',
                        clients: bhidConfig[section]['clients'],
                        connected: 0,
                    };
                    conf.serverConnections.set(connection.name, connection);

                    this._peer.openServer(
                        tracker,
                        connection.name,
                        {
                            connectAddress: connection.connectAddress,
                            connectPort: connection.connectPort,
                            encrypted: connection.encrypted,
                            fixed: connection.fixed,
                            peers: connection.clients,
                        }
                    );
                    openedConnections.add(section.substring(0, section.length - this.constructor.serverSection.length));
                } else if (section.endsWith(this.constructor.clientSection)) {
                    let tracker = section.split('#')[0];
                    if (!tracker)
                        continue;
                    let conf = this.list.get(tracker);
                    if (!conf) {
                        conf = { serverConnections: new Map(), clientConnections: new Map() };
                        this.list.set(tracker, conf);
                    }
                    let connection = {
                        name: section.substring(tracker.length + 1, section.length - this.constructor.clientSection.length),
                        listenAddress: bhidConfig[section]['listen_address'],
                        listenPort: bhidConfig[section]['listen_port'],
                        encrypted: bhidConfig[section]['encrypted'] == 'yes',
                        server: bhidConfig[section]['server'],
                        connected: 0,
                    };
                    conf.clientConnections.set(connection.name, connection);

                    this._peer.openClient(
                        tracker,
                        connection.name,
                        {
                            listenAddress: connection.listenAddress,
                            listenPort: connection.listenPort,
                            encrypted: connection.encrypted,
                            peers: connection.server,
                        }
                    );
                    openedConnections.add(section.substring(0, section.length - this.constructor.clientSection.length));
                }

                for (let connection of this._peer.connections.keys()) {
                    if (!openedConnections.has(connection))
                        this._peer.close(connection);
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
        let conf = { serverConnections: new Map(), clientConnections: new Map() };
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
            let openedConnections = new Set();
            let output = {};
            for (let section of Object.keys(bhidConfig)) {
                if (!section.endsWith(this.constructor.serverSection) &&
                    !section.endsWith(this.constructor.clientSection))
                {
                    output[section] = bhidConfig[section];
                }
            }

            for (let connection of list.serverConnections) {
                connection.connected = 0;

                output[trackerName + '#' + connection.name + this.constructor.serverSection] = {
                    connect_address: connection.connectAddress,
                    connect_port: connection.connectPort,
                    encrypted: connection.encrypted ? 'yes' : 'no',
                    fixed: connection.fixed ? 'yes' : 'no',
                    clients: connection.clients,
                };

                this._peer.openServer(
                    trackerName,
                    connection.name,
                    {
                        connectAddress: connection.connectAddress,
                        connectPort: connection.connectPort,
                        encrypted: connection.encrypted,
                        fixed: connection.fixed,
                        peers: connection.clients,
                    }
                );
                openedConnections.add(trackerName + '#' + connection.name);

                connection.connected = 0;
                conf.serverConnections.set(connection.name, connection);
            }
            for (let connection of list.clientConnections) {
                connection.connected = 0;

                output[trackerName + '#' + connection.name + this.constructor.clientSection] = {
                    listen_address: connection.listenAddress,
                    listen_port: connection.listenPort,
                    encrypted: connection.encrypted ? 'yes' : 'no',
                    server: connection.server,
                };

                this._peer.openClient(
                    trackerName,
                    connection.name,
                    {
                        listenAddress: connection.listenAddress,
                        listenPort: connection.listenPort,
                        encrypted: connection.encrypted,
                        peers: connection.server,
                    }
                );
                openedConnections.add(trackerName + '#' + connection.name);

                connection.connected = 0;
                conf.clientConnections.set(connection.name, connection);
            }

            fs.writeFileSync(path.join(configPath, 'bhid.conf'), ini.stringify(output));

            for (let connection of this._peer.connections.keys()) {
                if (!openedConnections.has(connection))
                    this._peer.close(connection);
            }
        } catch (error) {
            this._logger.error(new WError(error, 'ConnectionsList.set()'));
            return false;
        }

        this.list.set(trackerName, conf);
        return true;
    }

    /**
     * Retrieve peer server
     * @return {Peer}
     */
    get _peer() {
        if (this._peer_instance)
            return this._peer_instance;
        this._peer_instance = this._app.get('servers').get('peer');
        return this._peer_instance;
    }
}

module.exports = ConnectionsList;
