/**
 * Repo-saved application configuration
 */
module.exports = {
    // Project name (alphanumeric)
    project: 'bhid',

    // Load base classes and services, path names
    autoload: [
        '!src/servers',
        '!src/services',
        'commands',
        'servers',
    ],
};
