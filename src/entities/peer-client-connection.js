/**
 * Peer Client Connection Entity
 * @module entities/peer-client-connection
 */

/**
 * Peer Client Connection Entity
 */
class PeerClientConnection {
    /**
     * Create entity
     * @param {string} name
     */
    constructor(name) {
        this._name = name;                          // tracker#user@dom/path
        this._tracker = name.split('#')[0];
        this._registering = null;                   // on tracker
        this._registered = null;                    // on tracker
        this._listenAddress = null;
        this._listenPort = null;
        this._encrypted = null;
        this._fixed = null;                         // use peers list and no identity change
        this._peers = [];                           // [ 'tracker#user@dom?daemon' ]
        this._sessionIds = new Set();
        this._internal = [];                        // [ message InternalAddress ]
        this._external = null;                      // { address, port }
        this._trying = null;                        // null, 'internal' or 'external'
        this._successful = null;                    // connected and authenticated
    }

    /**
     * Service name is 'entities.peerClientConnection'
     * @type {string}
     */
    static get provides() {
        return 'entities.peerClientConnection';
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

    /**
     * Internal setter
     * @param {object[]} internal
     */
    set internal(internal) {
        this._internal = internal;
    }

    /**
     * Internal getter
     * @type {object[]}
     */
    get internal() {
        return this._internal;
    }

    /**
     * External setter
     * @param {object} external
     */
    set external(external) {
        this._external = external;
    }

    /**
     * External getter
     * @type {object}
     */
    get external() {
        return this._external;
    }

    /**
     * Trying setter
     * @param {null|string} trying
     */
    set trying(trying) {
        this._trying = trying;
    }

    /**
     * Trying getter
     * @type {null|string}
     */
    get trying() {
        return this._trying;
    }

    /**
     * Successful setter
     * @param {boolean} successful
     */
    set successful(successful) {
        this._successful = successful;
    }

    /**
     * Successful getter
     * @type {boolean}
     */
    get successful() {
        return this._successful;
    }
}

module.exports = PeerClientConnection;
