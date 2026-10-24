// src/tcp_server.js
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { dbOperations } from './models/db.operations.js';
import { parseLegacyDeviceOutput } from './utils/parser.js';
import { createLogger, fingerprint } from './utils/logger.js';
import { ContractViolationError } from './contracts/measurement.contract.js';

const PORT_TCP = process.env.PORT_TCP || 4000;
const log = createLogger('tcp');

const server = net.createServer((socket) => {
  const connLog = log.child({ connection_id: randomUUID().slice(0, 8) });
  const openedAt = Date.now();
  connLog.info('connection.opened', { remote: `${socket.remoteAddress}:${socket.remotePort}` });

  let dataAccumulator = '';
  socket.setEncoding('utf8');

  socket.on('data', (chunk) => {
    dataAccumulator += chunk;

    if (dataAccumulator.includes('|[END]')) {
      const frameParts = dataAccumulator.split('|');

      if (frameParts[0] === '[START]') {
        const deviceToken = frameParts[1];
        const rawPrintout = frameParts[2];

        const device = dbOperations.getDeviceByToken(deviceToken);

        if (device) {
          const parsedData = parseLegacyDeviceOutput(rawPrintout);

          const nosqlDocument = {
            raw_text: rawPrintout,
            parsed_density: parsedData.density,
            parsed_temperature: parsedData.temperature,
            fuel_status: parsedData.fuelStatus,
            comments: []
          };

          try {
            dbOperations.saveMeasurement(device.id, 1, nosqlDocument);
            connLog.info('frame.saved', {
              device_id: device.id,
              device: device.name,
              fuel_status: parsedData.fuelStatus,
              frame_bytes: dataAccumulator.length,
            });
            socket.write('[RESPONSE]|STATUS:OK|[END]');
          } catch (err) {
            if (!(err instanceof ContractViolationError)) throw err;
            connLog.warn('frame.rejected', { reason: 'contract_violation', device_id: device.id, errors: err.errors });
            socket.write('[RESPONSE]|STATUS:INVALID_DATA|[END]');
          }
        } else {
          // Logujemy tylko hash tokena, więc powtarzające się złe tokeny można bezpiecznie powiązać.
          connLog.warn('frame.rejected', { reason: 'invalid_device_token', credential_hash: fingerprint(deviceToken) });
          socket.write('[RESPONSE]|STATUS:AUTH_FAILED|[END]');
        }
      } else {
        connLog.warn('frame.rejected', { reason: 'missing_start_marker', frame_bytes: dataAccumulator.length });
      }
      dataAccumulator = '';
      socket.end();
    }
  });

  socket.on('error', (err) => {
    connLog.error('socket.error', { err });
  });

  socket.on('close', () => {
    connLog.info('connection.closed', { duration_ms: Date.now() - openedAt, bytes_read: socket.bytesRead });
  });
});

server.listen(PORT_TCP, '0.0.0.0', () => {
  log.info('server.listening', { port: Number(PORT_TCP) });
});
