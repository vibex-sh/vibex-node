/**
 * Vibex Client
 * Handles HTTP requests to the Vibex ingest API with async batching for performance
 */

const VibexConfig = require('./config');

// Batch configuration
const BATCH_SIZE = 50;  // Max logs per batch
const BATCH_INTERVAL_MS = 100;  // Max time to wait before sending batch (milliseconds)
const MAX_QUEUE_SIZE = 1000;  // Prevent memory issues

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

    // Batching queue and processing
    this._logQueue = [];
    this._batchTimeout = null;
    this._lastBatchTime = Date.now();
    this._processing = false;
    this._shutdown = false;

    if (!this.config.isValid()) {
      const missing = this.config.getMissing();
      this.disabled = true;
      if (this.verbose) {
        this._printStatus(`⚠️  Vibex SDK disabled: Missing configuration: ${missing.join(', ')}`);
      }
    } else {
      this._printStartupInfo();
      if (this.verbose) {
        this._printStatus('✅ Vibex SDK enabled and ready');
      }
    }

    // Register graceful shutdown
    if (typeof process !== 'undefined' && process.on) {
      process.on('exit', () => this.flush());
      process.on('SIGINT', () => {
        this.flush();
        process.exit();
      });
      process.on('SIGTERM', () => {
        this.flush();
        process.exit();
      });
    }
  }

  /**
   * Mask token for display (show first 6 chars, mask the rest)
   * @param {string} token - Token to mask
   * @returns {string} Masked token
   */
  _maskToken(token) {
    if (!token || token.length <= 6) {
      return '******';
    }
    return `${token.substring(0, 6)}${'*'.repeat(token.length - 6)}`;
  }

  /**
   * Print elegant startup information about vibex.sh
   */
  _printStartupInfo() {
    const maskedToken = this._maskToken(this.config.token);
    // Box width is 61 chars, "║  Server:  " is 11 chars, " ║" is 2 chars
    // So content width = 61 - 11 - 2 = 48 chars
    const contentWidth = 48;
    const server = this._padString(this.config.apiUrl, contentWidth);
    const session = this._padString(this.config.getSessionId(), contentWidth);
    const token = this._padString(maskedToken, contentWidth);
    
    const lines = [
      '',
      '                    vibex.sh is in action                      ',
      '═══════════════════════════════════════════════════════════════',
      `  Server:  ${server}`,
      `  Session: ${session}`,
      `  Token:   ${token}`,
      '═══════════════════════════════════════════════════════════════',
      ''
    ];
    
    console.error(lines.join('\n'));
    this._initializationMessageShown = true;
  }

  /**
   * Pad string to specified length for formatting
   * @param {string} str - String to pad
   * @param {number} length - Target length
   * @returns {string} Padded string
   */
  _padString(str, length) {
    if (!str) return ' '.repeat(length);
    if (str.length > length) {
      return str.substring(0, length);
    }
    return str + ' '.repeat(length - str.length);
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
   * Schedule batch processing
   */
  _scheduleBatch() {
    if (this._batchTimeout || this._processing || this._shutdown) {
      return;
    }

    this._batchTimeout = setTimeout(() => {
      this._processBatch();
    }, BATCH_INTERVAL_MS);
  }

  /**
   * Process and send batch of logs
   */
  async _processBatch() {
    if (this._processing || this._shutdown || this._logQueue.length === 0) {
      this._batchTimeout = null;
      return;
    }

    this._processing = true;
    this._batchTimeout = null;

    // Get batch (up to BATCH_SIZE)
    const batch = this._logQueue.splice(0, BATCH_SIZE);
    this._lastBatchTime = Date.now();

    if (batch.length > 0) {
      await this._sendBatch(batch);
    }

    this._processing = false;

    // Schedule next batch if queue has more items
    if (this._logQueue.length > 0 && !this._shutdown) {
      this._scheduleBatch();
    }
  }

  /**
   * Send a batch of logs to the API
   * @param {Array} batch - Array of log entries [logType, payload, timestamp]
   * @private
   */
  async _sendBatch(batch) {
    if (!batch || batch.length === 0 || this.disabled || this.disabledPermanently) {
      return;
    }

    if (!this.config.isValid()) {
      this.disabled = true;
      return;
    }

    try {
      const url = this.config.apiUrl;
      const sessionId = this.config.getSessionId();

      // Build logs array from batch
      const logs = batch.map(([logType, payload, timestamp]) => ({
        type: logType,
        payload: payload,
        timestamp: timestamp,
      }));

      const body = {
        sessionId: sessionId,
        logs: logs,
      };

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.token}`,
      };

      // Use native fetch if available (Node 18+), otherwise use HTTP
      let response;
      if (typeof globalThis.fetch !== 'undefined') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
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
      } else {
        // Use HTTP module for Node < 18
        response = await this._sendBatchHttp(url, headers, body);
      }

      if (!response) {
        return;
      }

      // Handle 403/401 - permanently disable
      if (response.status === 401 || response.status === 403) {
        const errorMsg = '🚫 Vibex SDK permanently disabled: Token expired or invalid (401/403)';
        if (this.verbose) {
          this._printStatus(errorMsg);
        }
        this.disabledPermanently = true;
        return;
      }

      // Handle 429 - rate limit exceeded or history limit reached
      if (response.status === 429) {
        let errorMessage = 'Rate limit exceeded';
        let isHistoryLimit = false;
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
          isHistoryLimit = errorData.error === 'History Limit Reached' || 
                          (errorMessage && errorMessage.toLowerCase().includes('history limit'));
        } catch (e) {
          // If parsing fails, use default message
        }
        
        const errorMsg = isHistoryLimit 
          ? `🚫 Vibex SDK: ${errorMessage}`
          : `⚠️  Vibex SDK: ${errorMessage}`;
        
        if (this.verbose) {
          this._printStatus(errorMsg);
        }
        
        if (isHistoryLimit) {
          this.disabledPermanently = true;
        }
        
        return;
      }

      // Handle 404 - session not found
      if (response.status === 404) {
        const errorMsg = '⚠️  Vibex SDK: Session not found (404), dropping batch';
        if (this.verbose) {
          this._printStatus(errorMsg);
        }
        return;
      }

      // Handle other errors
      if (!response.ok) {
        const errorMsg = `⚠️  Vibex SDK: Failed to send batch: ${response.status}`;
        if (this.verbose) {
          this._printStatus(errorMsg);
        }
        return;
      }

    } catch (error) {
      const errorMsg = `⚠️  Vibex SDK: Error sending batch: ${error.message}`;
      if (this.verbose) {
        this._printStatus(errorMsg);
      }
    }
  }

  /**
   * Send batch using HTTP module (Node < 18 fallback)
   * @private
   */
  _sendBatchHttp(url, headers, body) {
    return new Promise((resolve) => {
      const http = require('http');
      const https = require('https');
      const { URL } = require('url');
      
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;
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
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          // Create a response-like object
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            json: () => Promise.resolve(JSON.parse(responseData || '{}')),
          });
        });
      });

      req.on('error', () => {
        resolve(null);
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Send a log to the Vibex API (non-blocking, queues the log)
   * @param {string} logType - Type of log ('json' or 'text')
   * @param {any} payload - Log payload (object for json, string for text)
   * @param {number} timestamp - Optional timestamp in milliseconds
   * @returns {Promise<boolean>} True if queued successfully, False otherwise
   */
  async sendLog(logType, payload, timestamp = null) {
    if (this.disabled || this.disabledPermanently) {
      return false;
    }

    if (!this.config.isValid()) {
      this.disabled = true;
      return false;
    }

    // Check queue size limit
    if (this._logQueue.length >= MAX_QUEUE_SIZE) {
      // Queue is full - drop log to prevent memory issues
      return false;
    }

    // Queue the log
    const logEntry = [logType, payload, timestamp || Date.now()];
    this._logQueue.push(logEntry);

    // Schedule batch processing if not already scheduled
    if (!this._batchTimeout && !this._processing) {
      // Check if batch should be sent immediately (size limit)
      if (this._logQueue.length >= BATCH_SIZE) {
        setImmediate(() => this._processBatch());
      } else {
        this._scheduleBatch();
      }
    }

    return true;
  }

  /**
   * Flush all queued logs immediately (blocking)
   * Useful for graceful shutdown or ensuring logs are sent
   */
  async flush() {
    if (this._shutdown) {
      return;
    }

    this._shutdown = true;

    // Clear any pending timeout
    if (this._batchTimeout) {
      clearTimeout(this._batchTimeout);
      this._batchTimeout = null;
    }

    // Process remaining logs
    while (this._logQueue.length > 0 && !this.disabled && !this.disabledPermanently) {
      await this._processBatch();
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
      queueSize: this._logQueue.length,
      processing: this._processing,
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
      const sessionId = this.config.getSessionId();
      status.sessionId = sessionId ? `${sessionId.substring(0, 10)}...` : null;
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
      const queueInfo = status.queueSize > 0 ? ` (queue: ${status.queueSize})` : '';
      console.error(`✅ Vibex SDK: Enabled and ready${queueInfo}`);
    } else {
      console.error(`⚠️  Vibex SDK: ${status.reason}`);
    }
  }
}

module.exports = VibexClient;
