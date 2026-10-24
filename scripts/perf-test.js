import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer, get as httpGet, Agent } from 'node:http';
import { createConnection, createServer as createTcpServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const durationSeconds = Number(process.env.PERF_DURATION_SECONDS || 5);
const concurrency = Number(process.env.PERF_CONCURRENCY || 10);

if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) {
  throw new Error('PERF_DURATION_SECONDS must be an integer from 1 to 60.');
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  throw new Error('PERF_CONCURRENCY must be an integer from 1 to 100.');
}

async function getAvailablePort() {
  const server = createTcpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function runSeed(dbDir) {
  const result = spawnSync(process.execPath, ['src/seed.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_DIR: dbDir },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Seed failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

function startServer(entry, env) {
  const child = spawn(process.execPath, [entry], {
    cwd: ROOT,
    env: { ...process.env, ...env, LOG_LEVEL: 'error', LOG_FORMAT: 'json' },
    stdio: 'ignore',
  });
  let startupError;
  child.on('error', (error) => { startupError = error; });
  child.startupError = () => startupError;
  return child;
}

function assertRunning(child, label) {
  if (child.startupError()) throw child.startupError();
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`${label} exited during startup (${child.exitCode ?? child.signalCode}).`);
  }
}

async function waitForHttp(child, port) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    assertRunning(child, 'HTTP server');
    try {
      const response = await new Promise((resolve, reject) => {
        const request = httpGet({ host: '127.0.0.1', port, path: '/login', timeout: 500 }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        request.on('timeout', () => request.destroy(Object.assign(new Error('HTTP readiness request timed out.'), { code: 'ETIMEDOUT' })));
        request.on('error', reject);
      });
      if (response === 200) return;
    } catch (error) {
      if (!['ECONNREFUSED', 'ETIMEDOUT'].includes(error.code)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HTTP server did not become ready within 10 seconds.');
}

async function waitForTcp(child, port) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    assertRunning(child, 'TCP server');
    try {
      await new Promise((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', reject);
      });
      return;
    } catch (error) {
      if (error.code !== 'ECONNREFUSED') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('TCP server did not become ready within 10 seconds.');
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

async function benchmark(name, request, seconds, workers) {
  const latencies = [];
  let successes = 0;
  let failures = 0;
  let firstError;
  const startedAt = performance.now();
  const deadline = startedAt + seconds * 1000;

  await Promise.all(Array.from({ length: workers }, async () => {
    while (performance.now() < deadline) {
      const requestStartedAt = performance.now();
      try {
        await request();
        successes += 1;
      } catch (error) {
        failures += 1;
        firstError ??= error.message;
      }
      latencies.push(performance.now() - requestStartedAt);
    }
  }));

  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  return {
    name,
    requests: successes + failures,
    successful: successes,
    failed: failures,
    requests_per_second: Number((successes / elapsedSeconds).toFixed(1)),
    latency_ms: {
      p50: Number(percentile(latencies, 0.5).toFixed(2)),
      p95: Number(percentile(latencies, 0.95).toFixed(2)),
    },
    ...(firstError ? { first_error: firstError } : {}),
  };
}

function requestLogin(agent, port) {
  return new Promise((resolve, reject) => {
    const request = httpGet({ host: '127.0.0.1', port, path: '/login', agent, timeout: 5000 }, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode === 200) resolve();
        else reject(new Error(`GET /login returned ${res.statusCode}.`));
      });
    });
    request.on('timeout', () => request.destroy(new Error('HTTP request timed out.')));
    request.on('error', reject);
  });
}

function sendMeasurement(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let response = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else if (response.includes('STATUS:OK')) resolve();
      else reject(new Error(`TCP server returned an unexpected response: ${response || '(empty)'}`));
    };

    socket.setTimeout(5000, () => socket.destroy(new Error('TCP request timed out.')));
    socket.on('connect', () => {
      socket.write('[START]|token_aparat_diesel_9000|RESULT: GESTOSC: 830.0 KG/M3 RESULT: TEMP: 15.0 C|[END]');
    });
    socket.on('data', (chunk) => { response += chunk.toString(); });
    socket.on('error', finish);
    socket.on('close', () => finish());
  });
}

async function stopServers(servers) {
  const running = servers.filter((child) => child.exitCode === null && child.signalCode === null);
  for (const child of running) child.kill('SIGTERM');
  await Promise.all(running.map((child) => once(child, 'exit')));
}

const dbDir = await mkdtemp(path.join(tmpdir(), 'laboratorium-iot-perf-'));
const httpPort = await getAvailablePort();
let tcpPort = await getAvailablePort();
while (tcpPort === httpPort) tcpPort = await getAvailablePort();
const servers = [];

try {
  runSeed(dbDir);
  const httpServer = startServer('src/http_server.js', { DB_DIR: dbDir, PORT: String(httpPort) });
  servers.push(httpServer);
  const tcpServer = startServer('src/tcp_server.js', { DB_DIR: dbDir, PORT_TCP: String(tcpPort) });
  servers.push(tcpServer);

  await Promise.all([waitForHttp(httpServer, httpPort), waitForTcp(tcpServer, tcpPort)]);

  const agent = new Agent({ keepAlive: true, maxSockets: concurrency });
  try {
    const httpResult = await benchmark(
      'HTTP GET /login (keep-alive)',
      () => requestLogin(agent, httpPort),
      durationSeconds,
      concurrency,
    );
    const tcpResult = await benchmark(
      'TCP valid measurement frame (new connection per frame)',
      () => sendMeasurement(tcpPort),
      durationSeconds,
      concurrency,
    );

    console.log(JSON.stringify({
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      cpu: os.cpus()[0]?.model || 'unknown',
      logical_cpus: os.availableParallelism(),
      duration_seconds_per_scenario: durationSeconds,
      concurrency,
      database: 'temporary SQLite WAL database, seeded for this run',
      results: [httpResult, tcpResult],
    }, null, 2));

    if (httpResult.failed || tcpResult.failed) {
      throw new Error('Some benchmark requests failed; do not treat these measurements as a valid baseline.');
    }
  } finally {
    agent.destroy();
  }
} finally {
  await stopServers(servers);
  await rm(dbDir, { recursive: true, force: true });
}
