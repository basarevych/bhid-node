/**
 * Installation specific application configuration
 */
const path = require('path');

module.exports = {
    // Server instance name (alphanumeric)
    instance: 'daemon',

    // Environment
    env: process.env.NODE_ENV || 'production',

    // Loaded modules
    modules: [
        'daemon',
        'tracker',
        'peer',
    ],

    // Servers
    servers: {
        daemon: {
            class: 'servers.daemon',
        },
        tracker: {
            class: 'servers.tracker',
        },
        peer: {
            class: 'servers.peer',
        },
        front: {
            class: 'servers.front',
        },
    },

    // SMTP servers
    smtp: {
        main: {
            host: 'localhost',
            port: 25,
            ssl: false,
            //user: 'username',
            //password: 'password',
        },
    },

    email: {
        from: 'root@localhost',
        logger: {
            info_enabled: false,            // email logger.info() or not
            warn_enabled: false,            // email logger.warn() or not
            error_enabled: false,           // email logger.error() or not
            to: 'debug@example.com',
        },
        daemon: {
            enabled: false,                 // email program crash or not
            to: 'debug@example.com',
        },
    },

    logs: {
        main: {
            default: true,
            name: 'bhid.log',
            path: '/var/log/bhid',
            interval: '1d',
            mode: 0o640,
        },
    },
/*
    user: { // Drop privileges, otherwise comment out this section
        uid: 'www',
        gid: 'www',
    },
*/
};