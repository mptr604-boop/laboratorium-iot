// src/utils/serial_bridge.js
// Most: linie tekstu z portu szeregowego (ESP32 po USB) -> ramki protokołu TCP serwera LIMS.
// Serwer nie wie, czy nadawcą jest symulator, czy prawdziwy ESP32. Most tylko dopisuje token i ramkę.
// Zero zależności: port ustawia systemowe `stty`, a czytamy go zwykłym strumieniem pliku.

import net from 'node:net';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createLogger } from './logger.js';

const log = createLogger('serial-bridge');

/** Pierwszy znaleziony port USB-UART (ESP32 widać jako ttyUSB* albo ttyACM*). */
export function findSerialPort(dir = '/dev') {
  const names = fs.readdirSync(dir).filter((n) => /^tty(USB|ACM)\d+$/.test(n)).sort();
  return names.length ? `${dir}/${names[0]}` : null;
}

/** Ustawia 8N1, tryb surowy i prędkość (to samo co ręczne `stty -F ... raw -echo`). */
export function configurePort(port, baud = 115200) {
  execFileSync('stty', ['-F', port, String(baud), 'cs8', '-cstopb', '-parenb', 'raw', '-echo']);
}

// Linie z firmware bez danych: puste, komentarze (#...) i komunikat startowy.
// Szum z bootloadera i zrzuty paniki ESP32 (Guru Meditation, Backtrace) odfiltrowuje wymóg, by linia
// zaczynała się dokładnie jak odczyt albo błąd czujnika ze szkicu. Uszkodzone linie z "Temperatura:" przechodzą dalej,
// bo ocenia je parser (CORRUPTED_TRANSMISSION).
const LOOKS_LIKE_READING = /^(Temperatura:|Blad odczytu)/i;

/** Zwraca ramkę `[START]|token|linia|[END]` albo null, gdy linia nie jest odczytem. */
export function lineToFrame(line, token) {
  const text = line.trim();
  if (!text || text.startsWith('#') || /^DHT11 start/i.test(text)) return null;
  if (!LOOKS_LIKE_READING.test(text)) return null;
  // Znak "|" jest separatorem protokołu, więc nie może trafić do treści.
  return `[START]|${token}|${text.replaceAll('|', ' ')}|[END]`;
}

/** Dzieli strumień bajtów na linie (obsługuje \n i \r\n oraz linie rozcięte między fragmentami). */
export function splitLines(readable, onLine) {
  let buffer = '';
  readable.setEncoding?.('utf8');
  readable.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop(); // ostatni fragment może być niedokończoną linią
    lines.forEach(onLine);
  });
  readable.on('end', () => {
    if (buffer) onLine(buffer);
  });
}

/** Wysyła jedną ramkę i zwraca odpowiedź serwera (np. `[RESPONSE]|STATUS:OK|[END]`). */
export function sendFrame(frame, { host = '127.0.0.1', port = 4000, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host, () => socket.write(frame));
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('timeout')));
    socket.setEncoding('utf8');
    let response = '';
    socket.on('data', (d) => (response += d));
    socket.on('close', () => resolve(response));
    socket.on('error', reject);
  });
}

/** Spina całość: linie z `readable` -> ramki -> serwer. Błąd sieci nie przerywa pracy mostu. */
// Zabezpieczenie przed zalaniem bazy: ESP32 z odpiętym czujnikiem potrafi wpaść w pętlę restartów
// i wypluwać tysiące linii na sekundę, a firmware normalnie nadaje co 2 s. Nadmiar jest liczony, nie wysyłany.
export function runBridge(readable, { token, send = sendFrame, sendOptions, minIntervalMs = 500 } = {}) {
  const stats = { forwarded: 0, ignored: 0, failed: 0, throttled: 0 };
  let lastSentAt = 0;
  splitLines(readable, async (line) => {
    const frame = lineToFrame(line, token);
    if (!frame) {
      stats.ignored++;
      return;
    }
    const now = Date.now();
    if (now - lastSentAt < minIntervalMs) {
      stats.throttled++;
      return;
    }
    lastSentAt = now;
    try {
      const response = await send(frame, sendOptions);
      stats.forwarded++;
      log.info('frame.forwarded', { line: line.trim(), response });
    } catch (err) {
      stats.failed++;
      log.warn('frame.send_failed', { line: line.trim(), reason: err.message });
    }
  });
  return stats;
}
