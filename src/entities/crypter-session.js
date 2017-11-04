/**
 * Crypter Session Entity
 * @module entities/crypter-session
 */

/**
 * Crypter Session Entity
 */
class CrypterSession {
    /**
     * Create entity
     * @param {string} id
     */
    constructor(id) {
        this._id = id;
        this._connection = null;                                // 'tracker#user@dom/path'
        this._publicKey = null;
        this._privateKey = null;
        this._peerKey = null;
    }

    /**
     * Service name is 'entities.crypterSession'
     * @type {string}
     */
    static get provides() {
        return 'entities.crypterSession';
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
     * Connection setter
     * @param {string} connection
     */
    set connection(connection) {
        this._connection = connection;
    }

    /**
     * Connection getter
     * @type {string}
     */
    get connection() {
        return this._connection;
    }

    /**
     * Public key setter
     * @param {Buffer} publicKey
     */
    set publicKey(publicKey) {
        this._publicKey = publicKey;
    }

    /**
     * Public key getter
     * @type {Buffer}
     */
    get publicKey() {
        return this._publicKey;
    }

    /**
     * Private key setter
     * @param {Buffer} privateKey
     */
    set privateKey(privateKey) {
        this._privateKey = privateKey;
    }

    /**
     * Private key getter
     * @type {Buffer}
     */
    get privateKey() {
        return this._privateKey;
    }

    /**
     * Peer key setter
     * @param {Buffer} peerKey
     */
    set peerKey(peerKey) {
        this._peerKey = peerKey;
    }

    /**
     * Peer key getter
     * @type {Buffer}
     */
    get peerKey() {
        return this._peerKey;
    }
}

module.exports = CrypterSession;
