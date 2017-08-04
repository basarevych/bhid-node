/**
 * Front Server Connection Target Entity
 * @module entities/front-server-connection-target
 */

/**
 * Front Server Connection Target Entity
 */
class FrontServerConnectionTarget {
    /**
     * Create entity
     * @param {string} id
     */
    constructor(id) {
        this._id = id;                              // generated on the other side
        this._tunnelId = null;                      // session ID of Peer server
        this._socket = null;
        this._buffer = [];
        this._connected = null;
    }

    /**
     * Service name is 'entities.frontServerConnectionTarget'
     * @type {string}
     */
    static get provides() {
        return 'entities.frontServerConnectionTarget';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [];
    }

    /**
     * ID getter
     * @type {string}
     */
    get id() {
        return this._id;
    }

    /**
     * Tunnel ID setter
     * @param {string} tunnelId
     */
    set tunnelId(tunnelId) {
        this._tunnelId = tunnelId;
    }

    /**
     * Tunnel ID getter
     * @type {string}
     */
    get tunnelId() {
        return this._tunnelId;
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
     * Buffer setter
     * @param {Array} buffer
     */
    set buffer(buffer) {
        this._buffer = buffer;
    }

    /**
     * Buffer getter
     * @type {Array}
     */
    get buffer() {
        return this._buffer;
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
}

module.exports = FrontServerConnectionTarget;
