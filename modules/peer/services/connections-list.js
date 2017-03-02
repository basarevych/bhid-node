/**
 * Connections list
 * @module peer/services/connections-list
 */
const debug = require('debug')('bhid:connections-list');
const path = require('path');
const fs = require('fs');
const os = require('os');
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
        this._imports = new Map();

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
     * Get connections
     * @param {string} trackerName                  Tracker name
     * @return {object}
     */
    get(trackerName) {
        return this._list.get(trackerName);
    }

    /**
     * Get imported connections
     * @param {string} trackerName                  Tracker name
     * @return {object}
     */
    getImported(trackerName) {
        return this._imports.get(trackerName);
    }

    /**
     * Get the list
     * @return {Map}
     */
    getAll() {
        return this._list;
    }

    /**
     * Get imports list
     * @return {Map}
     */
    getAllImported() {
        return this._imports;
    }

    /**
     * Load connections list
     * @return {boolean}
     */
    load() {
        try {
            let configPath = (os.platform() == 'freebsd' ? '/usr/local/etc/bhid' : '/etc/bhid');
            try {
                fs.accessSync(path.join(configPath, 'bhid.conf'), fs.constants.R_OK);
            } catch (error) {
                throw new Error('Could not read bhid.conf');
            }

            this._list.clear();
            let bhidConfig = ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));
            let openedConnections = new Set();
            for (let section of Object.keys(bhidConfig)) {
                if (section.endsWith(this.constructor.serverSection)) {
                    let tracker = section.split('#')[0];
                    if (!tracker)
                        continue;
                    let conf = this._list.get(tracker);
                    if (!conf) {
                        conf = { serverConnections: new Map(), clientConnections: new Map() };
                        this._list.set(tracker, conf);
                    }
                    let connection = {
                        name: section.substring(tracker.length + 1, section.length - this.constructor.serverSection.length),
                        connectAddress: bhidConfig[section]['connect_address'],
                        connectPort: bhidConfig[section]['connect_port'],
                        encrypted: bhidConfig[section]['encrypted'] == 'yes',
                        fixed: bhidConfig[section]['fixed'] == 'yes',
                        clients: (bhidConfig[section]['fixed'] == 'yes') ? bhidConfig[section]['clients'] : [],
                        connected: 0,
                    };
                    conf.serverConnections.set(connection.name, connection);

                    this._peer.close(tracker + '#' + connection.name);
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
                    let conf = this._list.get(tracker);
                    if (!conf) {
                        conf = { serverConnections: new Map(), clientConnections: new Map() };
                        this._list.set(tracker, conf);
                    }
                    let connection = {
                        name: section.substring(tracker.length + 1, section.length - this.constructor.clientSection.length),
                        listenAddress: bhidConfig[section]['listen_address'] == '*' ? '' : bhidConfig[section]['listen_address'],
                        listenPort: bhidConfig[section]['listen_port'] == '*' ? '' : bhidConfig[section]['listen_port'],
                        encrypted: bhidConfig[section]['encrypted'] == 'yes',
                        fixed: bhidConfig[section]['fixed'] == 'yes',
                        server: bhidConfig[section]['server'] || '',
                        connected: 0,
                    };
                    conf.clientConnections.set(connection.name, connection);

                    this._peer.close(tracker + '#' + connection.name);
                    this._peer.openClient(
                        tracker,
                        connection.name,
                        {
                            listenAddress: connection.listenAddress,
                            listenPort: connection.listenPort,
                            encrypted: connection.encrypted,
                            fixed: connection.fixed,
                            peers: connection.server ? [ connection.server ] : [],
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
            return false;
        }

        return true;
    }

    /**
     * Set connections list
     * @param {string} trackerName          Tracker name
     * @param {object} list                 Connections list
     */
    set(trackerName, list) {
        for (let connection of this._peer.connections.keys()) {
            if (connection.startsWith(trackerName + '#'))
                this._peer.close(connection);
        }

        for (let connection of list.serverConnections)
            connection.connected = 0;
        for (let connection of list.clientConnections)
            connection.connected = 0;

        let conf = { serverConnections: new Map(), clientConnections: new Map() };
        this._list.set(trackerName, conf);

        for (let connection of list.serverConnections) {
            conf.serverConnections.set(connection.name, connection);
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
        }
        for (let connection of list.clientConnections) {
            conf.clientConnections.set(connection.name, connection);
            this._peer.openClient(
                trackerName,
                connection.name,
                {
                    listenAddress: connection.listenAddress,
                    listenPort: connection.listenPort,
                    encrypted: connection.encrypted,
                    fixed: connection.fixed,
                    peers: connection.server ? [ connection.server ] : [],
                }
            );
        }
    }

    /**
     * Create or update connection
     * @param {string} trackerName          Tracker name
     * @param {object} connectionName       Connection name
     * @param {boolean} server              Is server connection
     * @param {object} connection           Connection info
     * @param {boolean} [restart=true]      Restart connection
     */
    update(trackerName, connectionName, server, connection, restart = true) {
        let conf = this._list.get(trackerName);
        if (!conf) {
            conf = { serverConnections: new Map(), clientConnections: new Map() };
            this._list.set(trackerName, conf);
        }

        let connected = 0, found;
        for (let [ thisName, thisConnection ] of server ? conf.serverConnections : conf.clientConnections) {
            if (thisName == connectionName) {
                found = trackerName + '#' + thisName;
                if (!restart)
                    connected = thisConnection.connected;
                break;
            }
        }

        if (found && restart)
            this._peer.close(found);

        connection.connected = connected;
        if (server) {
            conf.serverConnections.set(connectionName, connection);
            let imported = this._imports.get(trackerName);
            if (imported)
                imported.serverConnections.delete(connectionName);

            if (!found || restart) {
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
            }
        } else {
            conf.clientConnections.set(connectionName, connection);
            let imported = this._imports.get(trackerName);
            if (imported)
                imported.clientConnections.delete(connectionName);

            if (!found || restart) {
                this._peer.openClient(
                    trackerName,
                    connection.name,
                    {
                        listenAddress: connection.listenAddress,
                        listenPort: connection.listenPort,
                        encrypted: connection.encrypted,
                        fixed: connection.fixed,
                        peers: connection.server ? [connection.server] : [],
                    }
                );
            }
        }
    }

    /**
     * Delete connection
     * @param {string} trackerName          Tracker name
     * @param {object} connectionName       Connection name
     * @param {boolean} server              Is server connection
     */
    delete(trackerName, connectionName, server) {
        let conf = this._list.get(trackerName);
        if (!conf)
            return;

        if (server) {
            if (conf.serverConnections.has(connectionName)) {
                this._peer.close(trackerName + '#' + connectionName);
                conf.serverConnections.delete(connectionName);
            }
        } else {
            if (conf.clientConnections.has(connectionName)) {
                this._peer.close(trackerName + '#' + connectionName);
                conf.clientConnections.delete(connectionName);
            }
        }
    }

    /**
     * Save connections list
     * @return {boolean}
     */
    save() {
        try {
            let configPath = (os.platform() == 'freebsd' ? '/usr/local/etc/bhid' : '/etc/bhid');
            try {
                fs.accessSync(path.join(configPath, 'bhid.conf'), fs.constants.R_OK);
            } catch (error) {
                throw new Error('Could not read bhid.conf');
            }

            let bhidConfig = ini.parse(fs.readFileSync(path.join(configPath, 'bhid.conf'), 'utf8'));
            let output = {};
            for (let section of Object.keys(bhidConfig)) {
                if (!section.endsWith(this.constructor.serverSection) &&
                    !section.endsWith(this.constructor.clientSection))
                {
                    output[section] = bhidConfig[section];
                }
            }

            for (let [ trackerName, list ] of this._list) {
                for (let [ name, connection ] of list.serverConnections) {
                    output[trackerName + '#' + connection.name + this.constructor.serverSection] = {
                        connect_address: connection.connectAddress,
                        connect_port: connection.connectPort,
                        encrypted: connection.encrypted ? 'yes' : 'no',
                        fixed: connection.fixed ? 'yes' : 'no',
                        clients: connection.fixed ? connection.clients : [],
                    };
                }
                for (let [ name, connection ] of list.clientConnections) {
                    output[trackerName + '#' + connection.name + this.constructor.clientSection] = {
                        listen_address: connection.listenPort ? connection.listenAddress : '*',
                        listen_port: connection.listenPort || '*',
                        encrypted: connection.encrypted ? 'yes' : 'no',
                        fixed: connection.fixed ? 'yes' : 'no',
                        server: connection.server,
                    };
                }
            }

            fs.writeFileSync(path.join(configPath, 'bhid.conf'), ini.stringify(output));
        } catch (error) {
            this._logger.error(new WError(error, 'ConnectionsList.save()'));
            return false;
        }

        return true;
    }

    /**
     * Import connections list
     * @param {string} trackerName          Tracker name
     * @param {string} token                Token
     * @param {object} list                 Connections list
     */
    import(trackerName, token, list) {
        let info = this._imports.get(trackerName);
        if (!info) {
            info = { serverConnections: new Map(), clientConnections: new Map() };
            this._imports.set(trackerName, info);
        }
        for (let connection of list.serverConnections) {
            connection.token = token;
            info.serverConnections.set(connection.name, connection);
        }
        for (let connection of list.clientConnections) {
            connection.token = token;
            info.clientConnections.set(connection.name, connection);
        }
    }

    /**
     * Get imported connection token
     * @param {string} trackerName          Tracker name
     * @param {string} connectionName       Connection name
     */
    getImport(trackerName, connectionName) {
        let info = this._imports.get(trackerName);
        if (!info)
            return undefined;

        let test = info.serverConnections.get(connectionName);
        if (test)
            return test;

        return info.clientConnections.get(connectionName);
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
