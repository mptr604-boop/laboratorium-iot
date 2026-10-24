// src/test/logger.test.js
// Testy jednostkowe loggera strukturalnego oraz test end-to-end identyfikatorów korelacji żądań.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createLogger,
  fingerprint,
  resolveRequestId,
  setLogSink,
  withRequestContext,
} from '../utils/logger.js';

function capture(fn) {
  const lines = [];
  setLogSink((line) => lines.push(JSON.parse(line)));
  try {
    fn();
  } finally {
    setLogSink(null);
  }
  return lines;
}

test('logger writes one JSON object per line with level, component and message', () => {
  const [entry] = capture(() => createLogger('unit').info('hello', { a: 1 }));
  assert.equal(entry.level, 'info');
  assert.equal(entry.component, 'unit');
  assert.equal(entry.msg, 'hello');
  assert.equal(entry.a, 1);
  assert.ok(!Number.isNaN(Date.parse(entry.ts)));
});

test('logger respects LOG_LEVEL', () => {
  process.env.LOG_LEVEL = 'warn';
  try {
    const lines = capture(() => {
      const log = createLogger('unit');
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');
    });
    assert.deepEqual(lines.map((l) => l.msg), ['w', 'e']);
  } finally {
    delete process.env.LOG_LEVEL;
  }
});

test('logger redacts secrets, including nested ones', () => {
  const [entry] = capture(() =>
    createLogger('unit').info('auth', { password: 'p', headers: { authorization: 'Bearer x' }, safe: 'ok' })
  );
  assert.equal(entry.password, '[REDACTED]');
  assert.equal(entry.headers.authorization, '[REDACTED]');
  assert.equal(entry.safe, 'ok');
});

test('logger serializes Error objects', () => {
  const [entry] = capture(() => createLogger('unit').error('boom', { err: new TypeError('bad') }));
  assert.equal(entry.err.name, 'TypeError');
  assert.equal(entry.err.message, 'bad');
  assert.ok(entry.err.stack.includes('TypeError'));
});

test('request ID from the context is attached across awaits', async () => {
  const lines = [];
  setLogSink((line) => lines.push(JSON.parse(line)));
  try {
    await withRequestContext({ requestId: 'req-12345678' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      createLogger('unit').info('after_await');
    });
    createLogger('unit').info('outside');
  } finally {
    setLogSink(null);
  }
  assert.equal(lines[0].request_id, 'req-12345678');
  assert.equal(lines[1].request_id, undefined);
});

test('child logger adds constant fields', () => {
  const [entry] = capture(() => createLogger('tcp').child({ connection_id: 'abc' }).info('opened'));
  assert.equal(entry.connection_id, 'abc');
});

test('resolveRequestId keeps a safe client value and replaces unsafe ones', () => {
  assert.equal(resolveRequestId('trace-abc12345'), 'trace-abc12345');
  assert.notEqual(resolveRequestId('x'), 'x');
  assert.notEqual(resolveRequestId('bad value with spaces\nand newline'), 'bad value with spaces\nand newline');
  assert.match(resolveRequestId(undefined), /^[0-9a-f-]{36}$/);
});

test('fingerprint is stable, short and does not contain the input', () => {
  assert.equal(fingerprint('secret-token'), fingerprint('secret-token'));
  assert.notEqual(fingerprint('a'), fingerprint('b'));
  assert.equal(fingerprint('secret-token').length, 8);
  assert.ok(!fingerprint('secret-token').includes('secret'));
});

test('HTTP server echoes X-Request-Id and logs the same ID (isolated DB, real process)', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-log-test-'));
  const port = 3100 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['src/http_server.js'], {
    env: { ...process.env, PORT: String(port), DB_DIR: dbDir, LOG_LEVEL: 'info' },
    cwd: process.cwd(),
  });

  const stdoutLines = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    stdoutLines.push(...parts.filter(Boolean));
  });

  try {
    const deadline = Date.now() + 10_000;
    while (!stdoutLines.some((l) => l.includes('server.listening'))) {
      if (Date.now() > deadline) throw new Error('server did not start: ' + stdoutLines.join('\n'));
      await new Promise((r) => setTimeout(r, 50));
    }

    const res = await fetch(`http://127.0.0.1:${port}/no-such-route?secret=1`, {
      headers: { 'X-Request-Id': 'trace-test-0001' },
    });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-request-id'), 'trace-test-0001');

    await new Promise((r) => setTimeout(r, 100));
    const entry = stdoutLines.map((l) => JSON.parse(l)).find((e) => e.msg === 'request.completed');
    assert.ok(entry, 'request.completed log line not found');
    assert.equal(entry.request_id, 'trace-test-0001');
    assert.equal(entry.status, 404);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.path, '/no-such-route');
    assert.ok(typeof entry.duration_ms === 'number');
  } finally {
    child.kill();
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});
