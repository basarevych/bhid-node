/**
 * Peer Session Entity
 * @module entities/peer-session
 */

/**
 * Peer Session Entity
 */
class PeerSession {
    /**
     * Create entity
     * @param {string} id
     */
    constructor(id) {
        this._id = id;
        this._socket = null;
        this._wrapper = null;
        this._connected = null;                                 // socket connected
        this._verified = null;                                  // peer is verified
        this._accepted = null;                                  // peer has verified us
        this._established = null;                               // announced as established
    }

    /**
     * Service name is 'entities.peerSession'
     * @type {string}
     */
    static get provides() {
        return 'entities.peerSession';
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
     * Verified setter
     * @param {boolean} verified
     */
    set verified(verified) {
        this._verified = verified;
    }

    /**
     * Verified getter
     * @type {boolean}
     */
    get verified() {
        return this._verified;
    }

    /**
     * Accepted setter
     * @param {boolean} accepted
     */
    set accepted(accepted) {
        this._accepted = accepted;
    }

    /**
     * Accepted getter
     * @type {boolean}
     */
    get accepted() {
        return this._accepted;
    }

    /**
     * Established setter
     * @param {boolean} established
     */
    set established(established) {
        this._established = established;
    }

    /**
     * Established getter
     * @type {boolean}
     */
    get established() {
        return this._established;
    }
}

module.exports = PeerSession;
