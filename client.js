/**
 * Vibex Client
 * Handles HTTP requests to the Vibex ingest API
 */

const VibexConfig = require('./config');

class VibexClient {
  /**
   * Initialize VibexClient
   * @param {VibexConfig} config - Optional VibexConfig instance. If null, creates new one.
   * @param {boolean} verbose - If true, print status messages to stderr
   */
  constructor(config = null, verbose = false) {
    this.config = config || new VibexConfig();
    this.disabled = false;
    this.disabledPermanently = false;
    this.verbose = verbose;
    this._initializationMessageShown = false;

    if (!this.config.isValid()) {
      const missing = this.config.getMissing();
      this.disabled = true;
      if (this.verbose) {
        this._printStatus(`⚠️  Vibex SDK disabled: Missing configuration: ${missing.join(', ')}`);
      }
    } else {
      if (this.verbose) {
        this._printStatus('✅ Vibex SDK enabled and ready');
      }
    }
  }

  /**
   * Print status message to stderr (visible even when stdout is redirected)
   * @param {string} message - Status message to print
   */
  _printStatus(message) {
    console.error(message);
    this._initializationMessageShown = true;
  }

  /**
   * Send a log to the Vibex API
   * @param {string} logType - Type of log ('json' or 'text')
   * @param {any} payload - Log payload (object for json, string for text)
   * @param {number} timestamp - Optional timestamp in milliseconds
   * @returns {Promise<boolean>} True if sent successfully, False otherwise
   */
  async sendLog(logType, payload, timestamp = null) {
    if (this.disabled || this.disabledPermanently) {
      return false;
    }

    if (!this.config.isValid()) {
      this.disabled = true;
      return false;
    }

    try {
      const url = this.config.apiUrl;
      const headers = {
        'Authorization': `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      };

      const body = {
        sessionId: this.config.sessionId,
        logs: [{
          type: logType,
          payload: payload,
          timestamp: timestamp || Date.now(),
        }],
      };

      // Use native fetch if available (Node 18+), otherwise require node-fetch
      let fetch;
      if (typeof globalThis.fetch !== 'undefined') {
        fetch = globalThis.fetch;
      } else {
        // For Node < 18, we'll use a simple HTTP request
        const http = require('http');
        const https = require('https');
        const { URL } = require('url');
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;

        return new Promise((resolve) => {
          const postData = JSON.stringify(body);
          const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
              ...headers,
              'Content-Length': Buffer.byteLength(postData),
            },
          };

          const req = client.request(options, (res) => {
            // Handle 403/401 - permanently disable
            if (res.statusCode === 401 || res.statusCode === 403) {
              const errorMsg = '🚫 Vibex SDK permanently disabled: Token expired or invalid (401/403)';
              if (this.verbose) {
                this._printStatus(errorMsg);
              }
              this.disabledPermanently = true;
              resolve(false);
              return;
            }

            // Handle 429 - rate limit exceeded
            if (res.statusCode === 429) {
              const errorMsg = '⚠️  Vibex SDK: Rate limit exceeded, dropping log';
              if (this.verbose) {
                this._printStatus(errorMsg);
              }
              resolve(false);
              return;
            }

            // Handle 404 - session not found
            if (res.statusCode === 404) {
              const errorMsg = '⚠️  Vibex SDK: Session not found (404), dropping log';
              if (this.verbose) {
                this._printStatus(errorMsg);
              }
              resolve(false);
              return;
            }

            // Handle other errors
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const errorMsg = `⚠️  Vibex SDK: Failed to send log: ${res.statusCode}`;
              if (this.verbose) {
                this._printStatus(errorMsg);
              }
              resolve(false);
              return;
            }

            resolve(true);
          });

          req.on('error', () => {
            // Fail-safe: silently handle errors
            resolve(false);
          });

          req.setTimeout(5000, () => {
            req.destroy();
            resolve(false);
          });

          req.write(postData);
          req.end();
        });
      }

      // Use native fetch (Node 18+)
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // Handle 403/401 - permanently disable
      if (response.status === 401 || response.status === 403) {
        const errorMsg = '🚫 Vibex SDK permanently disabled: Token expired or invalid (401/403)';
        if (this.verbose) {
          this._printStatus(errorMsg);
        }
        this.disabledPermanently = true;
        return false;
      }

      // Handle 429 - rate limit exceeded
      if (response.status === 429) {
        const errorMsg = '⚠️  Vibex SDK: Rate limit exceeded, dropping log';
        if (this.verbose) {
          this._printStatus(errorMsg);
        }
        return false;
      }

      // Handle 404 - session not found
      if (response.status === 404) {
        const errorMsg = '⚠️  Vibex SDK: Session not found (404), dropping log';
        if (this.verbose) {
          this._printStatus(errorMsg);
        }
        return false;
      }

      // Handle other errors
      if (!response.ok) {
        const errorMsg = `⚠️  Vibex SDK: Failed to send log: ${response.status}`;
        if (this.verbose) {
          this._printStatus(errorMsg);
        }
        return false;
      }

      return true;
    } catch (error) {
      // Fail-safe: handle errors
      const errorMsg = `⚠️  Vibex SDK: Error sending log: ${error.message}`;
      if (this.verbose) {
        this._printStatus(errorMsg);
      }
      return false;
    }
  }

  /**
   * Check if client is enabled and can send logs
   * @returns {boolean} True if enabled
   */
  isEnabled() {
    return !this.disabled && !this.disabledPermanently && this.config.isValid();
  }

  /**
   * Get detailed status information about the client
   * @returns {object} Status information including enabled state, reason if disabled, etc.
   */
  getStatus() {
    const status = {
      enabled: this.isEnabled(),
      disabled: this.disabled,
      disabledPermanently: this.disabledPermanently,
      configValid: this.config.isValid(),
    };

    if (!this.config.isValid()) {
      status.missingConfig = this.config.getMissing();
      status.reason = `Missing configuration: ${this.config.getMissing().join(', ')}`;
    } else if (this.disabledPermanently) {
      status.reason = 'Permanently disabled due to authentication error (401/403)';
    } else if (this.disabled) {
      status.reason = 'Disabled';
    } else {
      status.reason = 'Enabled and ready';
      status.apiUrl = this.config.apiUrl;
      status.sessionId = this.config.sessionId ? `${this.config.sessionId.substring(0, 10)}...` : null;
      status.tokenPrefix = this.config.token ? `${this.config.token.substring(0, 10)}...` : null;
    }

    return status;
  }

  /**
   * Print current status to stderr
   */
  printStatus() {
    const status = this.getStatus();
    if (status.enabled) {
      console.error('✅ Vibex SDK: Enabled and ready');
    } else {
      console.error(`⚠️  Vibex SDK: ${status.reason}`);
    }
  }
}

module.exports = VibexClient;

