/**
 * Token event
 * @module tracker/events/token
 */
const Base = require('./connect');

/**
 * Token event class
 */
class Token extends Base {
    /**
     * Service name is 'tracker.events.token'
     * @type {string}
     */
    static get provides() {
        return 'tracker.events.token';
    }

    /**
     * Event name
     * @type {string}
     */
    get name() {
        return 'token';
    }
}

module.exports = Token;
