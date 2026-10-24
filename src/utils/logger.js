// src/utils/logger.js
// Natywny logger strukturalny (linie JSON): poziomy, ID korelacji na żądanie, maskowanie sekretów.
// Zero zależności: tylko node:async_hooks i node:crypto.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SENSITIVE_KEY = /token|password|passwd|secret|authorization|cookie|jwt/i;
const MAX_DEPTH = 4;

const requestContext = new AsyncLocalStorage();

// Wyjście idzie przez wymienialny sink, więc testy mogą przechwytywać linie logów.
let sink = (line) => process.stdout.write(line + '\n');

export function setLogSink(fn) {
  sink = fn ?? ((line) => process.stdout.write(line + '\n'));
}

// Czytane przy każdym wywołaniu, więc LOG_LEVEL można zmienić bez restartu (także w testach).
function activeLevel() {
  return LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
}

/** Uruchamia fn z ID korelacji dołączanym do każdej linii logu emitowanej w środku (także po await). */
export function withRequestContext(context, fn) {
  return requestContext.run(context, fn);
}

export function getRequestId() {
  return requestContext.getStore()?.requestId;
}

/** Przyjmuje X-Request-Id od klienta tylko gdy jest krótki i bezpieczny; w przeciwnym razie generuje własny. */
export function resolveRequestId(headerValue) {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return typeof candidate === 'string' && /^[\w.-]{8,64}$/.test(candidate) ? candidate : randomUUID();
}

/** Krótki, stabilny hash: pozwala powiązać powtarzające się złe tokeny bez logowania samego tokena. */
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
    // Logowanie nigdy nie może przewrócić aplikacji.
  }
}

/**
 * Tworzy logger przypisany do nazwy komponentu (i opcjonalnych stałych pól, np. connection_id).
 * Użycie: log.info('measurement.saved', { device_id: 3 });
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
