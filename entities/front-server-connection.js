/**
 * Front Server Connection Entity
 * @module entities/front-server-connection
 */

/**
 * Front Server Connection Entity
 */
class FrontServerConnection {
    /**
     * Create entity
     * @param {string} name
     */
    constructor(name) {
        this._name = name;                          // tracker#user@dom/path
        this._address = null;                       // connect to
        this._port = null;
        this._encrypted = null;
        this._targets = new Map();                  // id => FrontServerConnectionTarget(id)
    }

    /**
     * Service name is 'entities.frontServerConnection'
     * @type {string}
     */
    static get provides() {
        return 'entities.frontServerConnection';
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
     * Server flag getter
     * @type {boolean}
     */
    get server() {
        return true;
    }

    /**
     * Address setter
     * @param {string} address
     */
    set address(address) {
        this._address = address;
    }

    /**
     * Address getter
     * @type {string}
     */
    get address() {
        return this._address;
    }

    /**
     * Port setter
     * @param {string} port
     */
    set port(port) {
        this._port = port;
    }

    /**
     * Port getter
     * @type {string}
     */
    get port() {
        return this._port;
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
     * Targets getter
     * @type {Map}
     */
    get targets() {
        return this._targets;
    }
}

module.exports = FrontServerConnection;
