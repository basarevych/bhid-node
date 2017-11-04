/**
 * Peer Server Connection Entity
 * @module entities/peer-server-connection
 */

/**
 * Peer Server Connection Entity
 */
class PeerServerConnection {
    /**
     * Create entity
     * @param {string} name
     */
    constructor(name) {
        this._name = name;                          // tracker#user@dom/path
        this._tracker = name.split('#')[0];
        this._registering = null;                   // on tracker
        this._registered = null;                    // on tracker
        this._connectAddress = null;
        this._connectPort = null;
        this._encrypted = null;
        this._fixed = null;                         // use peers list and no identity change
        this._peers = [];                           // [ 'tracker#user@dom?daemon' ]
        this._sessionIds = new Set();
    }

    /**
     * Service name is 'entities.peerServerConnection'
     * @type {string}
     */
    static get provides() {
        return 'entities.peerServerConnection';
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
     * Tracker setter
     * @param {string} tracker
     */
    set tracker(tracker) {
        this._tracker = tracker;
    }

    /**
     * Tracker getter
     * @type {string}
     */
    get tracker() {
        return this._tracker;
    }

    /**
     * Registering setter
     * @param {boolean} registering
     */
    set registering(registering) {
        this._registering = registering;
    }

    /**
     * Registering getter
     * @type {boolean}
     */
    get registering() {
        return this._registering;
    }

    /**
     * Registered setter
     * @param {boolean} registered
     */
    set registered(registered) {
        this._registered = registered;
    }

    /**
     * Registered getter
     * @type {boolean}
     */
    get registered() {
        return this._registered;
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
     * Peers setter
     * @param {string[]} peers
     */
    set peers(peers) {
        this._peers = peers;
    }

    /**
     * Peers getter
     * @type {string[]}
     */
    get peers() {
        return this._peers;
    }

    /**
     * Session IDs getter
     * @type {Set}
     */
    get sessionIds() {
        return this._sessionIds;
    }
}

module.exports = PeerServerConnection;
