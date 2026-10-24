// src/mock_esp32.js
// Symulator mikrokontrolera ESP32 wysyłającego surowe dane z aparatu laboratoryjnego przez TCP

import net from 'node:net';

const HOST_TCP = '127.0.0.1';
const PORT_TCP = process.env.PORT_TCP || 4000;

// Tokeny autoryzacyjne urządzeń
const TOKEN_ON = 'token_aparat_diesel_9000';
const TOKEN_PB = 'token_aparat_benzyna_400';

/**
 * Symuluje surowy wydruk starego aparatu do badania jakości oleju napędowego (Distyl Diesel 9000)
 * @param {boolean} forceError - Symuluje awarię czujnika albo złą partię
 * @returns {string} Surowy tekst ASCII w takiej formie, w jakiej drukuje go aparat
 */
function generateRawDieselPrintout(forceError = false) {
  // Norma gęstości dla oleju napędowego to 820 - 845 kg/m3
  const density = forceError 
    ? (Math.random() * 100 + 600).toFixed(1) // Poza normą: 600 - 700 kg/m3
    : (Math.random() * 25 + 821).toFixed(1);  // W normie: 821 - 846 kg/m3

  const temperature = (Math.random() * 4 + 13).toFixed(1);

  return `
    ========================================
    LABORATORIUM KONTROLI PALIW - RAPORT
    URZADZENIE: APARAT DISTYL DIESEL 9000
    ----------------------------------------
    PROBKA: OLEJ NAPEDOWY (ON)
    TEST ID: ${Math.floor(Math.random() * 10000)}
    
    RESULT: GESTOSC: ${density} KG/M3
    RESULT: TEMP: ${temperature} C
    
    STATUS ANALIZY: ZAKONCZONO
    ========================================
  `;
}

/**
 * Wysyła ramkę telemetrii przez surowe gniazdo TCP
 * Ramka protokołu: [START]|<TOKEN>|<RAW_TEXT>|[END]
 * @param {string} token 
 * @param {string} printoutText 
 */
function sendTCPTelemetryFrame(token, printoutText) {
  const socket = new net.Socket();

  socket.connect(PORT_TCP, HOST_TCP, () => {
    console.log(`[MOCK-ESP32] Connected to LIMS TCP server. Transmitting telemetry frame...`);
    const completeFrame = `[START]|${token}|${printoutText.trim()}|[END]`;
    socket.write(completeFrame);
  });

  socket.on('data', (responseData) => {
    console.log(`[MOCK-ESP32] Server response: ${responseData.toString()}`);
    socket.end();
  });

  socket.on('error', (err) => {
    console.error(`[MOCK-ESP32] TCP socket connection error: ${err.message}`);
  });
}

console.log('[MOCK-ESP32] ESP32 simulator started.');
console.log('[MOCK-ESP32] Streaming measurement telemetry every 5 seconds...');

setInterval(() => {
  const simulateError = Math.random() < 0.05;
  const printout = generateRawDieselPrintout(simulateError);
  sendTCPTelemetryFrame(TOKEN_ON, printout);
}, 5000);
