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
    this.apiUrl = process.env.VIBEX_API_URL || 'https://vibex.sh/api/v1/ingest';
  }

  /**
   * Check if configuration is valid (both token and session_id present)
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
}

module.exports = VibexConfig;

