# vibex.sh Node.js SDK

Fail-safe logging handler for sending logs to [vibex.sh](https://vibex.sh).

## Features

- **Fail-Safe**: Silently disables if configuration is missing or invalid
- **Kill Switch**: Permanently disables on 401/403 errors (expired/invalid tokens)
- **Easy Integration**: Drop-in Winston transport
- **Zero Dependencies** (except `winston`)

## Installation

```bash
npm install vibex-sdk winston
```

## Quick Start

1. Set environment variables:
```bash
export VIBEX_TOKEN=vb_live_your_token_here
export VIBEX_SESSION_ID=my-production-app
```

2. Use in your Node.js application:
```javascript
const winston = require('winston');
const { VibexHandler } = require('vibex-sdk');

// Create logger
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    new VibexHandler({ verbose: true }), // verbose shows status messages
  ],
});

// Use normally - only JSON logs are sent to Vibex
logger.info(JSON.stringify({ cpu: 45, memory: 78, status: 'healthy' }));
logger.info(JSON.stringify({ error: 'connection_failed', retry_count: 3 }));
```

## Configuration

The SDK reads configuration from environment variables:

- `VIBEX_TOKEN` (required): Your Vibex API token
- `VIBEX_SESSION_ID` (required): Your session ID
- `VIBEX_API_URL` (optional): API endpoint (default: `https://vibex.sh/api/v1/ingest`)

## Fail-Safe Behavior

The SDK is designed to be fail-safe:

1. **Missing Config**: If `VIBEX_TOKEN` or `VIBEX_SESSION_ID` is missing, the handler silently disables itself
2. **Invalid Token**: On 401/403 responses, the handler permanently disables for the process lifetime
3. **Network Errors**: All network errors are silently handled - your application continues normally
4. **Rate Limits**: On 429 (rate limit), logs are dropped but the handler remains enabled. Logs are still written to console by default (`passthroughConsole: true`)

## Console Passthrough Options

By default, logs are forwarded to Vibex and also written to `stderr` (console), ensuring you can always see your logs locally while they're sent to Vibex.

### `passthroughConsole` (default: `true`)

When enabled (default), logs are always written to `stderr` in addition to being sent to Vibex. This provides visibility into your logs while forwarding them to Vibex.

```javascript
// Default behavior - logs written to console and sent to Vibex
const handler = new VibexHandler(); // passthroughConsole: true by default

// To disable console output (logs only sent to Vibex)
const handler = new VibexHandler({ passthroughConsole: false });
```

### `passthroughOnFailure` (default: `false`)

When enabled, logs are written to `stderr` when sending to Vibex fails (rate limits, network errors, etc.). This is useful as an additional safety net, but with `passthroughConsole: true` by default, it's typically not needed.

```javascript
// Write logs to console only when sending fails
const handler = new VibexHandler({ passthroughConsole: false, passthroughOnFailure: true });
```

**Important:** Non-JSON logs are still discarded (only JSON-formatted logs are processed).

## Important: JSON-Only Logging

**Only JSON-formatted logs are sent to Vibex.** Non-JSON logs are automatically discarded. Always stringify your log data:

```javascript
// ✅ Good - JSON logs are sent
logger.info(JSON.stringify({ cpu: 45, memory: 78 }));

// ❌ Bad - Non-JSON logs are discarded
logger.info('Application started');
logger.info('High memory usage: 85%');
```

## Advanced Usage

### Direct Client Usage

```javascript
const { VibexClient, VibexConfig } = require('vibex-sdk');

const config = new VibexConfig();
const client = new VibexClient(config);

// Send custom log
await client.sendLog('json', { cpu: 45, memory: 78 });
```

### Check if Enabled

```javascript
const { VibexHandler } = require('vibex-sdk');

const handler = new VibexHandler();
if (handler.isEnabled()) {
  console.log('Vibex is active');
} else {
  console.log('Vibex is disabled (missing config or expired token)');
}
```

### Get Status

```javascript
const handler = new VibexHandler();
const status = handler.getStatus();
console.log(status);
// {
//   enabled: true,
//   disabled: false,
//   disabledPermanently: false,
//   configValid: true,
//   reason: 'Enabled and ready',
//   apiUrl: 'https://vibex.sh/api/v1/ingest',
//   sessionId: 'my-product...',
//   tokenPrefix: 'vb_live_y...'
// }
```

### Verbose Mode

Enable verbose mode to see status messages when the handler initializes or encounters errors:

```javascript
const handler = new VibexHandler({ verbose: true });
```

## Node.js Version Compatibility

- **Node.js 18+**: Uses native `fetch` API
- **Node.js 14-17**: Uses built-in `http`/`https` modules as fallback

## License

MIT

