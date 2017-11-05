/**
 * Crypter
 * @module services/crypter
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const NodeRSA = require('node-rsa');
const nacl = require('tweetnacl');
const NError = require('nerror');

class Crypter {
    /**
     * Create service
     * @param {App} app                     Application
     * @param {object} config               Configuration
     * @param {Logger} logger               Logger service
     */
    constructor(app, config, logger) {
        this.publicKey = null;
        this.privateKey = null;
        this.identity = null;

        this.sessions = new Map();          // id => CrypterSession(id)

        this._app = app;
        this._config = config;
        this._logger = logger;
        this._hash = 'sha256';
    }

    /**
     * Service name is 'crypter'
     * @type {string}
     */
    static get provides() {
        return 'crypter';
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app', 'config', 'logger' ];
    }

    /**
     * This service is a singleton
     */
    static get lifecycle() {
        return 'singleton';
    }

    /**
     * Lookup identity on tracker timeout
     * @type {number}
     */
    static get lookupTimeout() {
        return 2 * 1000; // ms
    }

    /**
     * Initialize
     * @param {string} publicKey                New public key
     * @param {string} privateKey               New private key
     */
    init(publicKey, privateKey) {
        this.publicKey = new NodeRSA(publicKey);
        this.privateKey = new NodeRSA(privateKey);

        let hash = crypto.createHash(this._hash);
        hash.update(publicKey.toString('base64'));
        this.identity = hash.digest('hex');
    }

    /**
     * Create session
     * @param {string} id                       Session ID
     * @param {string} name                     Connection full name
     * @return {boolean}
     */
    create(id, name) {
        let keyPair;
        try {
            keyPair = nacl.box.keyPair();
        } catch (error) {
            this._logger.error(new NError(error, `Crypter.create(): ${name}`));
            return false;
        }

        let session = this._app.get('entities.crypterSession', id);
        session.connection = name;
        session.publicKey = keyPair.publicKey;
        session.privateKey = keyPair.secretKey;
        session.peerKey = null;
        this.sessions.set(id, session);

        return true;
    }

    /**
     * Get session public key
     * @param {string} id                       Session ID
     * @return {string|null}
     */
    getPublicKey(id) {
        let session = this.sessions.get(id);
        if (!session)
            return null;

        return Buffer.from(session.publicKey).toString('base64');
    }

    /**
     * Sign data
     * @param {*} data                          Data to sign
     * @return {string}
     */
    sign(data) {
        let hash = crypto.createHash(this._hash);
        hash.update(data);
        let signBuffer = hash.digest('hex');
        return this.privateKey.sign(signBuffer, 'base64', 'hex');
    }

    /**
     * Verify peer identity
     * @param {string} id                       Session ID
     * @param {string} tracker                  Tracker to ask for key
     * @param {string} identity                 Peer supplied identity
     * @param {string} buffer                   Buffer
     * @param {string} signature                Signature of buffer
     * @param {boolean} [strict=false]          Allow identity change or not
     * @return {Promise}                        Resolves to { verified, name }
     */
    async verify(id, tracker, identity, buffer, signature, strict = false) {
        let session = this.sessions.get(id);
        if (!session)
            return { verified: false };

        let peer = await this._loadPeer(tracker, identity);
        if (!strict || !peer) {
            let trackerPeer = await this._lookupPeer(tracker, identity);
            if (trackerPeer) {
                let isDifferent = true;
                let isProtected = false;

                if (peer) {
                    isDifferent = peer.name !== trackerPeer.name || !peer.buffer.equals(trackerPeer.buffer);
                    for (let connection of this._peer.connections.values()) {
                        if (connection.fixed && connection.peers.indexOf(tracker + '#' + peer.name) !== -1) {
                            isProtected = true;
                            break;
                        }
                    }
                }

                if (isDifferent && !isProtected) {
                    if (peer)
                        await this._deletePeer(tracker, peer.name);
                    await this._savePeer(tracker, trackerPeer.name, trackerPeer.buffer);
                    peer = trackerPeer;
                }
            }
        }

        if (!peer)
            return { verified: false };

        let connection = this._peer.connections.get(session.connection);
        if (!connection)
            return { verified: false, name: peer.name };
        if (connection.fixed && connection.peers.indexOf(peer.name) === -1)
            return { verified: false, name: peer.name };

        let hash = crypto.createHash(this._hash);
        hash.update(buffer);
        let signBuffer = hash.digest('hex');

        return { verified: peer.key.verify(signBuffer, signature, 'hex', 'base64'), name: peer.name };
    }

    /**
     * Encrypt message
     * @param {string} id                       Session ID
     * @param {*} data                          Message
     * @return {object|boolean}                 False on failure or { nonce, encrypted }
     */
    encrypt(id, data) {
        let session = this.sessions.get(id);
        if (!session)
            return false;

        if (!session.sharedKey)
            session.sharedKey = nacl.box.before(session.peerKey, session.privateKey);

        let nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
        if (nonce.length !== nacl.secretbox.nonceLength) {
            this._logger.debug('crypter', `NaCl.randomBytes() failed`);
            return false;
        }

        let encrypted = nacl.box.after(data, nonce, session.sharedKey);
        if (!encrypted || !encrypted.length) {
            this._logger.debug('crypter', `NaCl.box.after() failed`);
            return false;
        }

        return { nonce: Buffer.from(nonce), encrypted: Buffer.from(encrypted) };
    }

    /**
     * Decrypt message
     * @param {string} id                       Session ID
     * @param {*} nonce                         Nonce
     * @param {*} data                          Message
     * @return {Buffer|boolean}                 False on failure or buffer
     */
    decrypt(id, nonce, data) {
        let session = this.sessions.get(id);
        if (!session)
            return false;

        if (!session.sharedKey)
            session.sharedKey = nacl.box.before(session.peerKey, session.privateKey);

        let decrypted = nacl.box.open.after(data, nonce, session.sharedKey);
        if (!decrypted || !decrypted.length)
            return false;

        return Buffer.from(decrypted);
    }

    /**
     * Destroy session
     * @param {string} id                       Session ID
     */
    destroy(id) {
        this.sessions.delete(id);
    }

    /**
     * Retrieve tracker server
     * @return {Tracker}
     */
    get _tracker() {
        if (this._tracker_instance)
            return this._tracker_instance;
        this._tracker_instance = this._app.get('servers').get('tracker');
        return this._tracker_instance;
    }

    /**
     * Retrieve peer server
     * @return {Peer}
     */
    get _peer() {
        if (this._peer_instance)
            return this._peer_instance;
        this._peer_instance = this._app.get('servers').get('peer');
        return this._peer_instance;
    }

    /**
     * Lookup peer by identity
     * @param {string} tracker                  Tracker name
     * @param {string} identity                 Peer identity
     * @return {Promise}
     * <code>
     * {
     *     name: 'user@dom/daemon',
     *     key: NodeRSA of public key,
     *     buffer: key as buffer,
     * }
     * </code>
     */
    async _lookupPeer(tracker, identity) {
        return new Promise((resolve, reject) => {
            try {
                let requestId = this._tracker.sendLookupIdentityRequest(tracker, identity);
                if (!requestId)
                    return resolve(null);

                let onResponse = (name, message) => {
                    if (message.messageId === requestId) {
                        this._tracker.removeListener('lookup_identity_response', onResponse);

                        if (message.lookupIdentityResponse.response !== this._tracker.LookupIdentityResponse.Result.FOUND)
                            return resolve(null);

                        this._logger.debug('crypter', `Looked up identity for ${message.lookupIdentityResponse.name}`);
                        resolve({
                            name: message.lookupIdentityResponse.name,
                            key: new NodeRSA(message.lookupIdentityResponse.key),
                            buffer: Buffer.from(message.lookupIdentityResponse.key),
                        });
                    }
                };

                this._tracker.on('lookup_identity_response', onResponse);

                setTimeout(
                    () => {
                        this._tracker.removeListener('lookup_identity_response', onResponse);
                        resolve(null);
                    },
                    this.constructor.lookupTimeout
                );
            } catch (error) {
                reject(new NError(error, 'Crypter._lookupPeer()'));
            }
        });
    }

    /**
     * Find and load peer
     * @param {string} tracker                  Tracker name
     * @param {string} identity                 Peer supplied identity
     * @return {Promise}                        Resolves to peer info
     * <code>
     * {
     *     name: 'user@dom/daemon',
     *     key: NodeRSA of public key,
     *     buffer: key as buffer,
     * }
     * </code>
     */
    async _loadPeer(tracker, identity) {
        let peersPath = (os.platform() === 'freebsd' ? '/usr/local/etc/bhid/peers' : '/etc/bhid/peers');
        try {
            fs.accessSync(path.join(peersPath, tracker), fs.constants.F_OK);
        } catch (error) {
            return null;
        }

        for (let file of fs.readdirSync(path.join(peersPath, tracker))) {
            let contents = fs.readFileSync(path.join(peersPath, tracker, file), 'utf8');

            let hash = crypto.createHash(this._hash);
            hash.update(contents.toString('base64'));
            let thisIdentity = hash.digest('hex');
            if (identity === thisIdentity) {
                let name = file.replace(/^(.*)\.rsa$/, '$1');
                this._logger.debug('crypter', `Found saved identity for ${name}`);
                return {
                    name: name,
                    key: new NodeRSA(contents),
                    buffer: Buffer.from(contents),
                };
            }
        }
        return null;
    }

    /**
     * Save peer identity
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Peer name
     * @param {buffer} key                      Peer public key
     * @return {Promise}
     */
    async _savePeer(tracker, name, key) {
        let peersPath = (os.platform() === 'freebsd' ? '/usr/local/etc/bhid/peers' : '/etc/bhid/peers');
        try {
            fs.accessSync(path.join(peersPath), fs.constants.F_OK);
        } catch (error) {
            return;
        }

        try {
            fs.accessSync(path.join(peersPath, tracker), fs.constants.F_OK);
        } catch (error) {
            try {
                fs.mkdirSync(path.join(peersPath, tracker));
            } catch (error) {
                return;
            }
        }

        fs.writeFileSync(path.join(peersPath, tracker, name + '.rsa'), key);
    }

    /**
     * Delete peer identity
     * @param {string} tracker                  Tracker name
     * @param {string} name                     Peer name
     * @return {Promise}
     */
    async _deletePeer(tracker, name) {
        let peersPath = (os.platform() === 'freebsd' ? '/usr/local/etc/bhid/peers' : '/etc/bhid/peers');
        try {
            fs.accessSync(path.join(peersPath, tracker, name + '.rsa'), fs.constants.F_OK);
        } catch (error) {
            return;
        }

        fs.unlinkSync(path.join(peersPath, tracker, name + '.rsa'));
    }
}

module.exports = Crypter;
