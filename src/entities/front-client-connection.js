/**
 * Front Client Connection Entity
 * @module entities/front-client-connection
 */

/**
 * Front Client Connection Entity
 */
class FrontClientConnection {
    /**
     * Create entity
     * @param {string} name
     */
    constructor(name) {
        this._name = name;                          // tracker#user@dom/path
        this._address = null;                       // connect to
        this._port = null;
        this._encrypted = null;
        this._tcp = null;
        this._clients = new Map();                  // id => FrontClientConnectionClient(id)
    }

    /**
     * Service name is 'entities.frontClientConnection'
     * @type {string}
     */
    static get provides() {
        return 'entities.frontClientConnection';
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
        return false;
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
     * TCP setter
     * @param {object} tcp
     */
    set tcp(tcp) {
        this._tcp = tcp;
    }

    /**
     * TCP getter
     * @type {object}
     */
    get tcp() {
        return this._tcp;
    }

    /**
     * Clients getter
     * @type {Map}
     */
    get clients() {
        return this._clients;
    }
}

module.exports = FrontClientConnection;
