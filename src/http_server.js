// src/http_server.js
// Główny punkt wejścia serwera HTTP z wbudowaną ochroną przed awarią procesu

import http from 'node:http';
import { handleRouting } from './routes/app.router.js';
import { initializeGlobalErrorHandler } from './utils/errorHandler.js';
import { createLogger, resolveRequestId, withRequestContext } from './utils/logger.js';

const log = createLogger('http');

// Globalna siatka bezpieczeństwa dla nieobsłużonych wyjątków i awarii
initializeGlobalErrorHandler();

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  const startedAt = process.hrtime.bigint();
  res.setHeader('X-Request-Id', requestId);

  // Jedna linia podsumowania na żądanie; 'close' odpala się też, gdy klient zerwie połączenie w trakcie odpowiedzi.
  res.on('close', () => {
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    log[level]('request.completed', {
      method: req.method,
      path: (req.url || '').split('?')[0],
      status,
      duration_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      aborted: !res.writableFinished,
    });
  });

  return withRequestContext({ requestId }, async () => {
    try {
      await handleRouting(req, res);
    } catch (criticalHttpError) {
      log.error('request.crashed', { err: criticalHttpError });
      process.emit('uncaughtException', criticalHttpError);

      try {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Critical LIMS server failure occurred.', request_id: requestId }));
      } catch {}
    }
  });
});

server.listen(PORT, () => {
  log.info('server.listening', { port: Number(PORT) });
});
