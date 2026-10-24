// src/http_server.js
// Main HTTP server entrypoint with built-in crash resilience boundary

import http from 'node:http';
import { handleRouting } from './routes/app.router.js';
import { initializeGlobalErrorHandler } from './utils/errorHandler.js';

// Initialize global crash and unhandled exception safety net
initializeGlobalErrorHandler();

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  try {
    await handleRouting(req, res);
  } catch (criticalHttpError) {
    console.error(`[HTTP-CRASH-BOUNDARY] Exception during request processing:`, criticalHttpError);
    process.emit('uncaughtException', criticalHttpError);

    try {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Critical LIMS server failure occurred.' }));
    } catch {}
  }
});

server.listen(PORT, () => {
  console.log(`[HTTP-SERVER] Native laboratory backend running on port: ${PORT}`);
});
