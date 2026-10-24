// src/utils/logger.js
// Native structured logger (JSON lines): levels, per-request correlation ID, secret redaction.
// Zero dependencies: node:async_hooks + node:crypto only.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SENSITIVE_KEY = /token|password|passwd|secret|authorization|cookie|jwt/i;
const MAX_DEPTH = 4;

const requestContext = new AsyncLocalStorage();

// Output goes through a replaceable sink, so tests can capture log lines.
let sink = (line) => process.stdout.write(line + '\n');

export function setLogSink(fn) {
  sink = fn ?? ((line) => process.stdout.write(line + '\n'));
}

// Read on every call so LOG_LEVEL can be changed without restarting (and in tests).
function activeLevel() {
  return LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
}

/** Runs fn with a correlation ID attached to every log line emitted inside (also across awaits). */
export function withRequestContext(context, fn) {
  return requestContext.run(context, fn);
}

export function getRequestId() {
  return requestContext.getStore()?.requestId;
}

/** Accepts a client-supplied X-Request-Id only if it is short and harmless; otherwise generates one. */
export function resolveRequestId(headerValue) {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return typeof candidate === 'string' && /^[\w.-]{8,64}$/.test(candidate) ? candidate : randomUUID();
}

/** Short stable hash: lets you correlate repeated bad tokens without ever logging the token itself. */
export function fingerprint(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 8);
}

function serializeError(err) {
  return { name: err.name, message: err.message, stack: err.stack };
}

function sanitize(value, depth = 0) {
  if (value instanceof Error) return serializeError(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(val, depth + 1);
  }
  return out;
}

function formatPretty(entry) {
  const { ts, level, component, msg, request_id, ...rest } = entry;
  const extras = Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  const rid = request_id ? ` (${request_id.slice(0, 8)})` : '';
  return `${ts.slice(11, 23)} ${level.toUpperCase().padEnd(5)} [${component}]${rid} ${msg}${extras ? ' ' + extras : ''}`;
}

function write(level, component, baseFields, msg, fields) {
  if (LEVELS[level] < activeLevel()) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    request_id: getRequestId(),
    ...sanitize({ ...baseFields, ...fields }),
  };

  try {
    sink(process.env.LOG_FORMAT === 'pretty' ? formatPretty(entry) : JSON.stringify(entry));
  } catch {
    // Logging must never crash the application.
  }
}

/**
 * Creates a logger bound to a component name (and optional constant fields, e.g. connection_id).
 * Usage: log.info('measurement.saved', { device_id: 3 });
 */
export function createLogger(component, baseFields = {}) {
  return {
    debug: (msg, fields) => write('debug', component, baseFields, msg, fields),
    info: (msg, fields) => write('info', component, baseFields, msg, fields),
    warn: (msg, fields) => write('warn', component, baseFields, msg, fields),
    error: (msg, fields) => write('error', component, baseFields, msg, fields),
    child: (extraFields) => createLogger(component, { ...baseFields, ...extraFields }),
  };
}
