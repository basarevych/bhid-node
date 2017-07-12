/**
 * Repo-saved application configuration
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const ini = require('ini');

let userConfig;
try {
    userConfig = ini.parse(fs.readFileSync(os.platform() === 'freebsd' ? '/usr/local/etc/bhid/bhid.conf' : '/etc/bhid/bhid.conf', 'utf8'));
} catch (error) {
    userConfig = {};
}

module.exports = {
    // Project name (alphanumeric)
    project: 'bhid',

    // Server instance name (alphanumeric)
    instance: 'daemon',

    // Environment
    env: process.env.NODE_ENV || (process.env.DEBUG ? 'development' : 'production'),

    // Load base classes and services, path names
    autoload: [
        '!arpen/src/services',
        'services',
        'servers',
        'commands',
    ],

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
            host: (userConfig.smtp && userConfig.smtp.host) || 'localhost',
            port: (userConfig.smtp && userConfig.smtp.port) || 25,
            ssl: !!(userConfig.smtp && userConfig.smtp.ssl === 'yes'),
            user: userConfig.smtp && userConfig.smtp.user,
            password: userConfig.smtp && userConfig.smtp.password,
        },
    },

    email: {
        from: 'root@localhost',
        log: {
            enable: false,                 // email logger messages or not
            level: 'error',
            to: 'debug@example.com',
        },
        crash: {
            enable: false,                 // email program crash or not
            to: 'debug@example.com',
        },
    },

    logs: {
        main: {
            level: (userConfig.daemon && userConfig.daemon.log_level) || 'info',
            default: true,
            name: 'bhid.log',
            path: '/var/log/bhid',
            interval: '1d',
            mode: 0o640,
            maxFiles: 3,
            history: 'bhid.log.history',
        },
    },

/*
     user: { // Drop privileges, otherwise comment out this section
     uid: 'www',
     gid: 'www',
     },
*/
};
