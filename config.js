/**
 * Configuration management for Vibex SDK
 * Loads VIBEX_TOKEN and VIBEX_SESSION_ID from environment variables
 */

class VibexConfig {
  /**
   * Initialize VibexConfig
   * Reads configuration from environment variables
   */
  constructor() {
    this.token = process.env.VIBEX_TOKEN || null;
    this.sessionId = process.env.VIBEX_SESSION_ID || null;
    
    // Determine API URL - use Worker URL (not web URL)
    // Match CLI architecture: use ingest endpoint on Worker
    const apiUrlEnv = process.env.VIBEX_API_URL;
    const workerUrl = process.env.VIBEX_WORKER_URL;
    
    if (apiUrlEnv) {
      this.apiUrl = apiUrlEnv;
    } else if (workerUrl) {
      // Use explicit Worker URL if set
      this.apiUrl = `${workerUrl.replace(/\/$/, '')}/api/v1/ingest`;
    } else {
      // Production default - use Worker URL (not web URL)
      // For local development, set VIBEX_WORKER_URL=http://localhost:8787
      this.apiUrl = 'https://ingest.vibex.sh/api/v1/ingest';
    }
  }

  /**
   * Normalize session ID to always have vibex- prefix if missing
   * @param {string} sessionId - Session ID to normalize
   * @returns {string} Normalized session ID
   */
  _normalizeSessionId(sessionId) {
    if (!sessionId) {
      return null;
    }
    // If it doesn't start with 'vibex-', add it
    if (!sessionId.startsWith('vibex-')) {
      return `vibex-${sessionId}`;
    }
    return sessionId;
  }

  /**
   * Check if configuration is valid (both token and session_id required)
   * @returns {boolean} True if configuration is valid
   */
  isValid() {
    return !!(this.token && this.sessionId);
  }

  /**
   * Get list of missing configuration variables
   * @returns {string[]} Array of missing variable names
   */
  getMissing() {
    const missing = [];
    if (!this.token) {
      missing.push('VIBEX_TOKEN');
    }
    if (!this.sessionId) {
      missing.push('VIBEX_SESSION_ID');
    }
    return missing;
  }

  /**
   * Get normalized session ID
   * @returns {string} Normalized session ID with vibex- prefix
   */
  getSessionId() {
    return this._normalizeSessionId(this.sessionId);
  }
}

module.exports = VibexConfig;

