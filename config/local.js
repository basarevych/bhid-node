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
    ],

    // Servers
    servers: {
        daemon: {
            class: 'servers.daemon',
        },
        tracker: {
            class: 'servers.tracker',
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
        launcher: {
            enabled: false,                 // email program crash or not
            to: 'debug@example.com',
        },
    },

/*
    user: { // Drop privileges, otherwise comment out this section
        uid: 'www',
        gid: 'www',
    },
*/
};