/**
 * Phase 1.7: Log Normalization
 * Intelligently transforms log records into hybrid JSON structure
 */

/**
 * Normalize log level from various formats
 */
function normalizeLevel(level) {
  if (!level) {
    return 'debug';
  }
  
  const levelStr = String(level).toLowerCase();
  
  // Map common variations
  if (['debug', 'dbg', 'trace'].includes(levelStr)) {
    return 'debug';
  }
  if (['info', 'information', 'log'].includes(levelStr)) {
    return 'info';
  }
  if (['warn', 'warning', 'wrn'].includes(levelStr)) {
    return 'warn';
  }
  if (['error', 'err', 'exception', 'fatal', 'critical'].includes(levelStr)) {
    return 'error';
  }
  
  return 'debug'; // Default
}

/**
 * Extract metrics from payload (predictive)
 */
function extractMetrics(payload) {
  const metrics = {};
  
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return metrics;
  }
  
  // If metrics object exists, use it
  if (payload.metrics && typeof payload.metrics === 'object' && !Array.isArray(payload.metrics)) {
    for (const [key, value] of Object.entries(payload.metrics)) {
      if (typeof value === 'number') {
        metrics[key] = value;
      }
    }
    return metrics;
  }
  
  // Otherwise, predict from top-level numeric fields
  const knownContextFields = new Set([
    'trace_id', 'traceId', 'user_id', 'userId', 'request_id', 'requestId',
    'correlation_id', 'correlationId', 'span_id', 'spanId', 'session_id', 'sessionId',
    'id', 'pid', 'port', 'year', 'timestamp', 'time', 'date', 'createdAt', 'updatedAt',
    'datetime', 'ts', 'utc', 'iso', 'exc_info', 'exception', 'error', 'message', 'msg'
  ]);
  
  for (const [key, value] of Object.entries(payload)) {
    const keyLower = key.toLowerCase();
    
    // Skip known context fields
    if (knownContextFields.has(keyLower)) {
      continue;
    }
    
    // Skip timestamp fields
    if (keyLower.includes('timestamp') || keyLower.includes('time') || keyLower.includes('date')) {
      continue;
    }
    
    // Extract numeric values as potential metrics
    if (typeof value === 'number') {
      // Recognize common metric patterns
      if (key.endsWith('_ms') || key.endsWith('_count') || key.endsWith('_size') ||
          key.endsWith('Ms') || key.endsWith('Count') || key.endsWith('Size') ||
          ['cpu', 'memory', 'latency', 'response_time', 'duration'].some(pattern => keyLower.includes(pattern))) {
        metrics[key] = value;
      }
    }
  }
  
  return metrics;
}

/**
 * Extract context from payload (predictive)
 */
function extractContext(payload) {
  const context = {};
  
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return context;
  }
  
  // If context object exists, use it
  if (payload.context && typeof payload.context === 'object' && !Array.isArray(payload.context)) {
    return payload.context;
  }
  
  // Otherwise, predict from known context fields
  const knownContextFields = {
    'trace_id': 'trace_id',
    'traceId': 'trace_id',
    'user_id': 'user_id',
    'userId': 'user_id',
    'request_id': 'request_id',
    'requestId': 'request_id',
    'correlation_id': 'correlation_id',
    'correlationId': 'correlation_id',
    'span_id': 'span_id',
    'spanId': 'span_id',
    'session_id': 'session_id',
    'sessionId': 'session_id',
  };
  
  for (const [field, normalizedKey] of Object.entries(knownContextFields)) {
    if (payload[field] !== undefined) {
      context[normalizedKey] = payload[field];
    }
  }
  
  return context;
}

/**
 * Normalize log record to hybrid JSON structure
 */
function normalizeToHybrid(message, level, payload, extra = {}) {
  // Merge payload and extra
  const merged = { ...(payload || {}), ...(extra || {}) };
  
  // Extract message
  let normalizedMessage = message;
  if (!normalizedMessage && merged.message) {
    normalizedMessage = merged.message;
  }
  if (!normalizedMessage && merged.msg) {
    normalizedMessage = merged.msg;
  }
  // Don't invent default values - can be null/undefined
  
  // Extract and normalize level
  const normalizedLevel = normalizeLevel(level || merged.level || merged.severity || merged.log_level);
  
  // Extract metrics
  const metrics = extractMetrics(merged);
  
  // Extract context
  const context = extractContext(merged);
  
  // Extract annotation if present
  const annotation = merged._annotation;
  
  // Build hybrid structure
  const hybrid = {
    message: normalizedMessage, // Can be null/undefined
    level: normalizedLevel,
    metrics: metrics,
    context: context,
  };
  
  if (annotation) {
    hybrid._annotation = annotation;
  }
  
  // Preserve original payload fields that aren't in hybrid structure
  // This allows backward compatibility
  for (const [key, value] of Object.entries(merged)) {
    if (!['message', 'msg', 'level', 'severity', 'log_level', 'metrics', 'context', '_annotation'].includes(key)) {
      if (!(key in hybrid)) {
        hybrid[key] = value;
      }
    }
  }
  
  return hybrid;
}

module.exports = {
  normalizeLevel,
  extractMetrics,
  extractContext,
  normalizeToHybrid,
};

