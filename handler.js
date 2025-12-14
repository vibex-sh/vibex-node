/**
 * Vibex Logging Handler
 * Winston Transport implementation for Vibex
 */

const winston = require('winston');
const VibexClient = require('./client');
const VibexConfig = require('./config');

class VibexHandler extends winston.Transport {
  /**
   * Initialize VibexHandler
   * @param {object} options - Configuration options
   * @param {VibexConfig} options.config - Optional VibexConfig instance. If null, loads from environment.
   * @param {boolean} options.verbose - If true, print status messages to stderr when handler is initialized or errors occur.
   * @param {boolean} options.passthroughConsole - If true, always write logs to stderr in addition to sending to Vibex (default: true).
   * @param {boolean} options.passthroughOnFailure - If true, write logs to stderr when sending to Vibex fails (default: false).
   */
  constructor(options = {}) {
    super(options);

    const { config = null, verbose = false, passthroughConsole = true, passthroughOnFailure = false } = options;
    this.client = new VibexClient(config, verbose);
    this.passthroughConsole = passthroughConsole;
    this.passthroughOnFailure = passthroughOnFailure;
  }

  /**
   * Log method called by winston
   * @param {object} info - Log info object from winston
   * @param {Function} callback - Callback function
   */
  async log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    try {
      // Get the actual message content
      const message = info.message || info[Symbol.for('message')] || String(info);

      // Try to parse message as JSON - if it's JSON, use it directly as payload
      // Discard non-JSON logs entirely (only send structured JSON data)
      try {
        const parsed = JSON.parse(message);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // Message is a JSON object - use it as the payload directly
          const payload = { ...parsed };

          // Add exception info if present
          if (info.error || info.err) {
            const error = info.error || info.err;
            payload.exc_info = error.stack || error.message || String(error);
          }

          // Track whether we should write to console
          let shouldWriteToConsole = this.passthroughConsole;
          let sendSucceeded = false;

          // Try to send to Vibex if enabled
          if (this.client.isEnabled()) {
            const timestamp = info.timestamp ? new Date(info.timestamp).getTime() : Date.now();
            try {
              sendSucceeded = await this.client.sendLog('json', payload, timestamp);
              // If passthroughOnFailure is enabled and sending failed, write to console
              if (this.passthroughOnFailure && !sendSucceeded) {
                shouldWriteToConsole = true;
              }
            } catch (error) {
              // If passthroughOnFailure is enabled and sending errored, write to console
              if (this.passthroughOnFailure) {
                shouldWriteToConsole = true;
              }
            }
          } else if (this.passthroughOnFailure) {
            // Client is disabled, treat as failure
            shouldWriteToConsole = true;
          }

          // Write to console if needed
          if (shouldWriteToConsole) {
            try {
              // Format payload with timestamp for console output
              const consoleOutput = {
                timestamp: info.timestamp ? new Date(info.timestamp).getTime() : Date.now(),
                ...payload
              };
              console.error(JSON.stringify(consoleOutput));
            } catch (error) {
              // Fail-safe: silently ignore console write errors
            }
          }
        }
        // If parsed is not an object (string, number, etc.), discard it
      } catch (parseError) {
        // Message is not JSON - discard it completely
      }
    } catch (error) {
      // Fail-safe: silently ignore all errors
      this.emit('error', error);
    }

    callback();
  }

  /**
   * Check if handler is enabled
   * @returns {boolean} True if enabled
   */
  isEnabled() {
    return this.client.isEnabled();
  }

  /**
   * Get detailed status information about the handler
   * @returns {object} Status information
   */
  getStatus() {
    return this.client.getStatus();
  }

  /**
   * Print current handler status to stderr
   */
  printStatus() {
    this.client.printStatus();
  }
}

module.exports = VibexHandler;

