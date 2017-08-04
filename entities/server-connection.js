/**
 * Server Connection Entity
 * @module entities/server-connection
 */

/**
 * Server Connection Entity
 */
class ServerConnection {
    /**
     * Create entity
     * @param {string} name
     */
    constructor(name) {
        this._name = name;                          // user@dom/path
        this._connectAddress = null;
        this._connectPort = null;
        this._encrypted = null;
        this._fixed = null;
        this._clients = [];                         // [ 'user@dom?daemon' ]
        this._connected = 0;
    }

    /**
     * Service name is 'entities.serverConnection'
     * @type {string}
     */
    static get provides() {
        return 'entities.serverConnection';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [];
    }

    /**
     * Name getter
     * @type {string}
     */
    get name() {
        return this._name;
    }

    /**
     * Connect Address setter
     * @param {string} connectAddress
     */
    set connectAddress(connectAddress) {
        this._connectAddress = connectAddress;
    }

    /**
     * Connect Address getter
     * @type {string}
     */
    get connectAddress() {
        return this._connectAddress;
    }

    /**
     * Connect Port setter
     * @param {string} connectPort
     */
    set connectPort(connectPort) {
        this._connectPort = connectPort;
    }

    /**
     * Connect Port getter
     * @type {string}
     */
    get connectPort() {
        return this._connectPort;
    }

    /**
     * Encrypted setter
     * @param {boolean} encrypted
     */
    set encrypted(encrypted) {
        this._encrypted = encrypted;
    }

    /**
     * Encrypted getter
     * @type {boolean}
     */
    get encrypted() {
        return this._encrypted;
    }

    /**
     * Fixed setter
     * @param {boolean} fixed
     */
    set fixed(fixed) {
        this._fixed = fixed;
    }

    /**
     * Fixed getter
     * @type {boolean}
     */
    get fixed() {
        return this._fixed;
    }

    /**
     * Clients setter
     * @param {string[]} clients
     */
    set clients(clients) {
        this._clients = clients;
    }

    /**
     * Clients getter
     * @type {string[]}
     */
    get clients() {
        return this._clients;
    }

    /**
     * Connected setter
     * @param {number} connected
     */
    set connected(connected) {
        this._connected = connected;
    }

    /**
     * Connected getter
     * @type {number}
     */
    get connected() {
        return this._connected;
    }
}

module.exports = ServerConnection;
