/**
 * Crypter
 * @module peer/services/crypter
 */
const debug = require('debug')('bhid:crypter');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid');
const crypto = require('crypto');
const NodeRSA = require('node-rsa');
const nacl = require('tweetnacl');
const WError = require('verror').WError;

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

        this.sessions = new Map();

        this._app = app;
        this._config = config;
        this._logger = logger;
        this._hash = 'sha256';
    }

    /**
     * Service name is 'modules.peer.crypter'
     * @type {string}
     */
    static get provides() {
        return 'modules.peer.crypter';
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
        return 5 * 1000; // ms
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
     * @param {string} name                     Connection name
     * @return {string|null}                    Session ID or null
     */
    create(name) {
        let id = uuid.v1(), keyPair;
        try {
            keyPair = nacl.box.keyPair();
        } catch (error) {
            this._logger.error(new WError(error, `Crypter.create(): ${name}`));
            return null;
        }

        let session = {
            id: id,
            connection: name,
            publicKey: keyPair.publicKey,
            privateKey: keyPair.secretKey,
            peerKey: null,
        };
        this.sessions.set(id, session);
        return id;
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
     * @param {string} signature                Signature
     * @return {object}                         Returns { verified, name }
     */
    verify(id, tracker, identity, buffer, signature) {
        let session = this.sessions.get(id);
        if (!session)
            return Promise.resolve({ verified: false });

        return this._loadPeer(identity)
            .then(peer => {
                if (peer)
                    return peer;

                return new Promise((resolve, reject) => {
                    try {
                        let requestId = this._tracker.sendLookupIdentityRequest(tracker, identity);
                        if (!requestId)
                            return resolve(false);

                        let onResponse = (name, message) => {
                            if (message.messageId == requestId) {
                                this._tracker.removeListener('lookup_identity_response', onResponse);

                                if (message.lookupIdentityResponse.response != this._tracker.LookupIdentityResponse.Result.FOUND)
                                    return resolve(false);

                                resolve({
                                    name: message.lookupIdentityResponse.name,
                                    key: new NodeRSA(message.lookupIdentityResponse.key),
                                });
                            }
                        };
                        this._tracker.on('lookup_identity_response', onResponse);
                        setTimeout(() => {
                            this._tracker.removeListener('lookup_identity_response', onResponse);
                            resolve(false);
                        }, this.constructor.lookupTimeout);
                    } catch (error) {
                        reject(new new WError(error, 'Crypter.verify()'));
                    }
                });
            })
            .then(peer => {
                if (!peer)
                    return { verified: false };

                let connection = this._peer.connections.get(session.connection);
                if (!connection)
                    return { verified: false };
                if (connection.server) {
                    if (connection.fixed && connection.peers.indexOf(peer.name) == -1)
                        return { verified: false };
                } else {
                    if (connection.peers.indexOf(peer.name) == -1)
                        return { verified: false };
                }

                let hash = crypto.createHash(this._hash);
                hash.update(buffer);
                let signBuffer = hash.digest('hex');

                return { verified: peer.key.verify(signBuffer, signature, 'hex', 'base64'), name: peer.name };
            });
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
        if (nonce.length != nacl.secretbox.nonceLength) {
            debug(`NaCl.randomBytes() failed`);
            return false;
        }

        let encrypted = nacl.box.after(data, nonce, session.sharedKey);
        if (!encrypted || !encrypted.length) {
            debug(`NaCl.box.after() failed`);
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
     * Find and load peer
     * @param {string} identity                 Peer supplied identity
     * @return {object}                         Peer info
     * <code>
     * {
     *     name: 'user@example.com/daemon-name',
     *     publicKey: NodeRSA(),
     * }
     * </code>
     */
    _loadPeer(identity) {
        if (!this._peersPath) {
            for (let candidate of ['/etc/bhid', '/usr/local/etc/bhid']) {
                try {
                    fs.accessSync(path.join(candidate, 'peers'), fs.constants.F_OK);
                    this._peersPath = path.join(candidate, 'peers');
                    break;
                } catch (error) {
                    // do nothing
                }
            }
        }

        if (!this._peersPath)
            return Promise.resolve(null);

        return new Promise((resolve, reject) => {
            try {
                for (let file of fs.readdirSync(this._peersPath)) {
                    let buffer = fs.readFileSync(path.join(this._peersPath, file));

                    let hash = crypto.createHash(this._hash);
                    hash.update(buffer.toString('base64'));
                    let thisIdentity = hash.digest('hex');
                    if (identity === thisIdentity) {
                        return resolve({
                            name: file.replace(/^(.*)\.rsa$/, '$1'),
                            key: new NodeRSA(buffer),
                        });
                    }
                }
                resolve(null);
            } catch (error) {
                reject(new WError(error, 'Crypter._loadPeer()'));
            }
        });
    }
}

module.exports = Crypter;
