/**
 * Base class of command
 * @module commands/base
 */
const path = require('path');
const net = require('net');
const SocketWrapper = require('socket-wrapper');

/**
 * Command class
 */
class BaseCommand {
    /**
     * Create the service
     * @param {App} app                 The application
     */
    constructor(app) {
        this._app = app;
    }

    /**
     * Dependencies as constructor arguments
     * @type {string[]}
     */
    static get requires() {
        return [ 'app' ];
    }

    /**
     * Send request and return response
     * @param {Buffer} request
     * @param {string} [sockName]
     * @return {Promise}
     */
    async send(request, sockName) {
        return new Promise((resolve, reject) => {
            let sock;
            if (sockName && sockName[0] === '/')
                sock = sockName;
            else
                sock = path.join('/var', 'run', 'bhid', `daemon${sockName ? '.' + sockName : ''}.sock`);

            let onError = async error => {
                return reject(`Could not connect to daemon: ${error.message}`);
            };

            let socket = net.connect(sock, async () => {
                await this._app.debug('Connected to daemon');
                socket.removeListener('error', onError);
                socket.once('error', async error => { return this.error(error); });

                let wrapper = new SocketWrapper(socket);
                wrapper.on('receive', async data => {
                    await this._app.debug('Got daemon reply');
                    resolve(data);
                    socket.end();
                });
                wrapper.send(request);
            });
            socket.on('error', onError);
        });
    }

    /**
     * Log error and terminate
     * @param {...*} args
     * @return {Promise}
     */
    async error(...args) {
        try {
            await args.reduce(
                async (prev, cur) => {
                    await prev;
                    return this._app.error(cur.fullStack || cur.stack || cur.message || cur);
                },
                Promise.resolve()
            );
        } catch (error) {
            // do nothing
        }
        process.exit(1);
    }
}

module.exports = BaseCommand;
