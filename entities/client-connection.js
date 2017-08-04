/**
 * Client Connection Entity
 * @module entities/client-connection
 */

/**
 * Client Connection Entity
 */
class ClientConnection {
    /**
     * Create entity
     * @param {string} name
     */
    constructor(name) {
        this._name = name;                          // user@dom/path
        this._listenAddress = null;
        this._listenPort = null;
        this._encrypted = null;
        this._fixed = null;
        this._server = null;                        // 'user@dom?daemon'
        this._connected = 0;
    }

    /**
     * Service name is 'entities.clientConnection'
     * @type {string}
     */
    static get provides() {
        return 'entities.clientConnection';
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
     * Listen Address setter
     * @param {string} listenAddress
     */
    set listenAddress(listenAddress) {
        this._listenAddress = listenAddress;
    }

    /**
     * Listen Address getter
     * @type {string}
     */
    get listenAddress() {
        return this._listenAddress;
    }

    /**
     * Listen Port setter
     * @param {string} listenPort
     */
    set listenPort(listenPort) {
        this._listenPort = listenPort;
    }

    /**
     * Listen Port getter
     * @type {string}
     */
    get listenPort() {
        return this._listenPort;
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
     * Server setter
     * @param {string} server
     */
    set server(server) {
        this._server = server;
    }

    /**
     * Server getter
     * @type {string}
     */
    get server() {
        return this._server;
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

module.exports = ClientConnection;
