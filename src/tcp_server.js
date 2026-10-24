// src/tcp_server.js
import net from 'node:net';
import { dbOperations } from './models/db.operations.js';
import { parseLegacyDeviceOutput } from './utils/parser.js';

const PORT_TCP = process.env.PORT_TCP || 4000;

const server = net.createServer((socket) => {
  console.log(`[TCP] Connection established with IoT device: ${socket.remoteAddress}:${socket.remotePort}`);
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
          console.log(`[TCP] Authorization successful: ${device.name}. Processing telemetry...`);
          const parsedData = parseLegacyDeviceOutput(rawPrintout);
          
          const nosqlDocument = {
            raw_text: rawPrintout,
            parsed_density: parsedData.density,
            parsed_temperature: parsedData.temperature,
            status_paliwa: parsedData.fuelStatus,
            comments: []
          };

          dbOperations.saveMeasurement(device.id, 1, nosqlDocument);
          socket.write('[RESPONSE]|STATUS:OK|[END]');
        } else {
          console.warn(`[TCP] SECURITY ALERT: Invalid device token: ${deviceToken}`);
          socket.write('[RESPONSE]|STATUS:AUTH_FAILED|[END]');
        }
      }
      dataAccumulator = '';
      socket.end();
    }
  });

  socket.on('error', (err) => {
    console.error(`[TCP] Socket error: ${err.message}`);
  });
});

server.listen(PORT_TCP, '0.0.0.0', () => {
  console.log(`[TCP-SERVER] IoT hardware acquisition layer listening on port: ${PORT_TCP}`);
});
