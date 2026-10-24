// src/esp32_dht11.js
// Źródło danych "ESP32 + DHT11". Jeśli ESP32 jest podłączony po USB, czytamy prawdziwy sprzęt.
// Jeśli nie ma go w systemie, symulujemy dokładnie te same linie, które wypisuje szkic z laboratorium-ai/examples/esp32-dht11.
//
//   npm run esp32                      # automatycznie: sprzęt albo symulator
//   ESP32_PORT=/dev/ttyUSB0 npm run esp32
//   ESP32_SIMULATE=1 npm run esp32     # wymuś symulator mimo podłączonego ESP32
//
// Uwaga: z portu szeregowego czyta naraz tylko jeden program. Zamknij `platformio device monitor`, `cat`, `screen`.

import fs from 'node:fs';
import { configurePort, findSerialPort, runBridge, sendFrame, lineToFrame } from './utils/serial_bridge.js';

const TOKEN = process.env.ESP32_TOKEN || 'token_esp32_dht11';
const BAUD = Number(process.env.ESP32_BAUD || 115200);
const PORT_TCP = Number(process.env.PORT_TCP || 4000);
const sendOptions = { port: PORT_TCP };

const port = process.env.ESP32_SIMULATE ? null : process.env.ESP32_PORT || findSerialPort();

if (port) {
  console.log(`[ESP32] Prawdziwy sprzęt: ${port} @ ${BAUD} baud -> TCP :${PORT_TCP}`);
  configurePort(port, BAUD);
  const stream = fs.createReadStream(port);
  stream.on('error', (err) => {
    console.error(`[ESP32] Błąd portu: ${err.message}. Czy inny program nie trzyma portu?`);
    process.exit(1);
  });
  runBridge(stream, { token: TOKEN, sendOptions });
} else {
  console.log(`[ESP32] Nie znaleziono ESP32, działa SYMULATOR (te same linie co firmware) -> TCP :${PORT_TCP}`);
  setInterval(async () => {
    const line =
      Math.random() < 0.05
        ? 'Blad odczytu z DHT11 - sprawdz okablowanie'
        : `Temperatura: ${(22 + Math.random() * 3).toFixed(1)} C, Wilgotnosc: ${Math.round(40 + Math.random() * 10)} %`;
    try {
      console.log(`[ESP32-SIM] ${line} -> ${await sendFrame(lineToFrame(line, TOKEN), sendOptions)}`);
    } catch (err) {
      console.error(`[ESP32-SIM] ${err.message}`);
    }
  }, 2000);
}
