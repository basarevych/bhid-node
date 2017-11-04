/**
 * Tracker Server Entity
 * @module entities/tracker-server
 */

/**
 * Tracker Server Entity
 */
class TrackerServer {
    /**
     * Create entity
     * @param {string} name
     */
    constructor(name) {
        this._name = name;
        this._email = null;                                     // our email reported by tracker
        this._daemonName = null;                                // our name reported by tracker
        this._socket = null;
        this._wrapper = null;
        this._address = null;
        this._port = null;
        this._options = {};                                     // socket options
        this._token = null;                                     // daemon token
        this._connected = null;
        this._registered = null;
    }

    /**
     * Service name is 'entities.trackerServer'
     * @type {string}
     */
    static get provides() {
        return 'entities.trackerServer';
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
     * Email setter
     * @param {string} email
     */
    set email(email) {
        this._email = email;
    }

    /**
     * Email getter
     * @type {string}
     */
    get email() {
        return this._email;
    }

    /**
     * Daemon name setter
     * @param {string} daemonName
     */
    set daemonName(daemonName) {
        this._daemonName = daemonName;
    }

    /**
     * Daemon name getter
     * @type {string}
     */
    get daemonName() {
        return this._daemonName;
    }

    /**
     * Socket setter
     * @param {object} socket
     */
    set socket(socket) {
        this._socket = socket;
    }

    /**
     * Socket getter
     * @type {object}
     */
    get socket() {
        return this._socket;
    }

    /**
     * Socket Wrapper setter
     * @param {object} wrapper
     */
    set wrapper(wrapper) {
        this._wrapper = wrapper;
    }

    /**
     * Socket Wrapper getter
     * @type {object}
     */
    get wrapper() {
        return this._wrapper;
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
     * Options setter
     * @param {object} options
     */
    set options(options) {
        this._options = options;
    }

    /**
     * Options getter
     * @type {object}
     */
    get options() {
        return this._options;
    }

    /**
     * Token setter
     * @param {string} token
     */
    set token(token) {
        this._token = token;
    }

    /**
     * Token getter
     * @type {string}
     */
    get token() {
        return this._token;
    }

    /**
     * Connected setter
     * @param {boolean} connected
     */
    set connected(connected) {
        this._connected = connected;
    }

    /**
     * Connected getter
     * @type {boolean}
     */
    get connected() {
        return this._connected;
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
}

module.exports = TrackerServer;
