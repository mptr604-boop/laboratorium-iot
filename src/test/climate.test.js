// src/test/climate.test.js
// Czujnik klimatu (ESP32 + DHT11): parser, kontrakt, most serial -> TCP i przepływ end-to-end przez prawdziwy serwer TCP.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { parseLegacyDeviceOutput, toMeasurementFields, isFaultyMeasurement } from '../utils/parser.js';
import { validateMeasurement } from '../contracts/measurement.contract.js';
import { findSerialPort, lineToFrame, runBridge, splitLines } from '../utils/serial_bridge.js';

const LINE = 'Temperatura: 23.7 C, Wilgotnosc: 42 %';

// --- Parser ---

test('climate parser: odczyt z szkicu ESP32', () => {
  assert.deepEqual(parseLegacyDeviceOutput(LINE, 'climate'), { kind: 'climate', temperature: 23.7, humidity: 42, fuelStatus: 'NORMAL' });
});

test('climate parser: "Blad odczytu" z firmware to awaria czujnika', () => {
  const parsed = parseLegacyDeviceOutput('Blad odczytu z DHT11 - sprawdz okablowanie', 'climate');
  assert.equal(parsed.fuelStatus, 'DEVICE_FAULT');
  assert.equal(parsed.temperature, 'ERR');
});

test('climate parser: uszkodzona linia (zgubione znaki) to CORRUPTED_TRANSMISSION', () => {
  assert.equal(parseLegacyDeviceOutput('Tmperatura 23.7 , Wlgotnosc 42', 'climate').fuelStatus, 'CORRUPTED_TRANSMISSION');
});

test('climate parser: wartość poza zakresem DHT11 to OUT_OF_SPEC (zgubiona cyfra w zakresie nie zostanie wykryta bez sumy kontrolnej)', () => {
  assert.equal(parseLegacyDeviceOutput('Temperatura: 123.7 C, Wilgotnosc: 42 %', 'climate').fuelStatus, 'OUT_OF_SPEC');
  assert.equal(parseLegacyDeviceOutput('Temperatura: 23.7 C, Wilgotnosc: 3 %', 'climate').fuelStatus, 'OUT_OF_SPEC');
});

test('profil paliwa działa jak wcześniej, także gdy tekst zawiera słowa z czujnika', () => {
  const parsed = parseLegacyDeviceOutput('RESULT: GESTOSC: 832.4 KG/M3\nRESULT: TEMP: 15.1 C');
  assert.deepEqual(parsed, { density: 832.4, temperature: 15.1, fuelStatus: 'NORMAL' });
});

// --- Kontrakt i klasyfikacja ---

test('kontrakt: pomiar klimatu bez gęstości jest poprawny, a wilgotność 120 % nie', () => {
  const doc = { raw_text: LINE, ...toMeasurementFields(parseLegacyDeviceOutput(LINE, 'climate')), comments: [] };
  assert.equal(doc.parsed_density, undefined);
  assert.equal(validateMeasurement(doc).ok, true);
  assert.equal(validateMeasurement({ ...doc, parsed_humidity: 120 }).ok, false);
});

test('kontrakt: awaria czujnika zapisuje ERR w temperaturze i wilgotności', () => {
  const fields = toMeasurementFields(parseLegacyDeviceOutput('Blad odczytu z DHT11', 'climate'));
  assert.equal(validateMeasurement({ raw_text: 'x', ...fields, comments: [] }).ok, true);
});

test('isFaultyMeasurement: klimat ocenia status, paliwo progi gęstości; null nie jest traktowany jak 0', () => {
  assert.equal(isFaultyMeasurement({ parsed_humidity: 42, fuel_status: 'NORMAL' }), false);
  assert.equal(isFaultyMeasurement({ parsed_humidity: 3, fuel_status: 'OUT_OF_SPEC' }), true);
  assert.equal(isFaultyMeasurement({ parsed_density: 830, fuel_status: 'NORMAL' }), false);
  assert.equal(isFaultyMeasurement({ parsed_density: 700, fuel_status: 'OUT_OF_SPEC' }), true);
  assert.equal(isFaultyMeasurement({ parsed_density: 'ERR', fuel_status: 'DEVICE_FAULT' }), true);
});

// --- Most serial -> TCP ---

test('most: ramka z tokenem, szum i komentarze są pomijane, "|" nie psuje protokołu', () => {
  assert.equal(lineToFrame(LINE + '\r', 'tok'), `[START]|tok|${LINE}|[END]`);
  assert.equal(lineToFrame('# DHT11 start', 'tok'), null);
  assert.equal(lineToFrame('DHT11 start', 'tok'), null);
  assert.equal(lineToFrame('   ', 'tok'), null);
  assert.equal(lineToFrame('rst:0x1 (POWERON_RESET),boot:0x13', 'tok'), null);
  for (const noise of ["Guru Meditation Error: Core  1 panic'ed (Interrupt wdt timeout on CPU1).", 'Backtrace: 0x400d5236:0x3ffb1e80', 'A2      : 0x00000000  A3      : 0x00060023', 'entry 0x4008059c']) {
    assert.equal(lineToFrame(noise, 'tok'), null, noise);
  }
  assert.equal(lineToFrame('Blad odczytu z DHT11 - sprawdz okablowanie', 'tok') !== null, true);
  assert.ok(!lineToFrame('Temperatura: 1 C | Wilgotnosc: 40 %', 'tok').slice(7).includes('|Wilg'));
});

test('most: linia rozcięta między fragmentami strumienia składa się poprawnie', () => {
  const lines = [];
  const stream = new Readable({ read() {} });
  splitLines(stream, (l) => lines.push(l));
  stream.push('Temperatura: 23');
  stream.push('.7 C, Wilgotnosc: 42 %\r\nBla');
  stream.push('d odczytu\n');
  stream.push(null);
  return new Promise((resolve) =>
    stream.on('end', () => {
      assert.deepEqual(lines, [LINE, 'Blad odczytu']);
      resolve();
    }),
  );
});

test('most: runBridge wysyła ramki, liczy pominięte, a błąd sieci nie przerywa pracy', async () => {
  const sent = [];
  let calls = 0;
  const send = async (frame) => {
    if (++calls === 1) throw new Error('ECONNREFUSED');
    sent.push(frame);
    return 'OK';
  };
  const stream = Readable.from([`${LINE}\n# komentarz\n${LINE}\n${LINE}\n`]);
  const stats = runBridge(stream, { token: 't', send, minIntervalMs: 0 });
  await new Promise((r) => stream.on('end', r));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(stats, { forwarded: 2, ignored: 1, failed: 1, throttled: 0 });
  assert.equal(sent.length, 2);
});

test('findSerialPort: znajduje ttyUSB/ttyACM, ignoruje inne urządzenia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-'));
  assert.equal(findSerialPort(dir), null);
  for (const n of ['tty0', 'ttyS0', 'null', 'ttyUSB1', 'ttyUSB0']) fs.writeFileSync(path.join(dir, n), '');
  assert.equal(findSerialPort(dir), `${dir}/ttyUSB0`);
});

// --- End-to-end: linia z "ESP32" -> most -> prawdziwy tcp_server -> baza ---

test('e2e: linie z czujnika trafiają przez TCP do bazy jako pomiary klimatu', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-climate-'));
  const tcpPort = await new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
  const env = { ...process.env, DB_DIR: dbDir, PORT_TCP: String(tcpPort), LOG_LEVEL: 'info', SEED_DEFAULT_PASSWORD: 'test-haslo-123' };
  const seeded = spawnSync(process.execPath, ['src/seed.js'], { env, cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);

  const server = spawn(process.execPath, ['src/tcp_server.js'], { env, cwd: process.cwd() });
  try {
    let output = '';
    server.stdout.on('data', (d) => (output += d));
    for (let i = 0; i < 100 && !output.includes('server.listening'); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(output.includes('server.listening'), 'serwer TCP nie wystartował');

    const lines = [LINE, 'Blad odczytu z DHT11 - sprawdz okablowanie', 'Temperatura: 70.0 C, Wilgotnosc: 42 %'];
    const stream = Readable.from([lines.join('\n') + '\n']);
    const stats = runBridge(stream, { token: 'token_esp32_dht11', sendOptions: { port: tcpPort }, minIntervalMs: 0 });
    await new Promise((r) => stream.on('end', r));
    for (let i = 0; i < 100 && stats.forwarded < 3; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(stats.forwarded, 3, JSON.stringify(stats));

    const db = new DatabaseSync(path.join(dbDir, 'laboratorium.sqlite'));
    const rows = db.prepare('SELECT nosql_data FROM measurements ORDER BY id').all().map((r) => JSON.parse(r.nosql_data));
    db.close();
    assert.deepEqual(rows.map((r) => r.fuel_status).sort(), ['DEVICE_FAULT', 'NORMAL', 'OUT_OF_SPEC']);
    const ok = rows.find((r) => r.fuel_status === 'NORMAL');
    assert.equal(ok.parsed_temperature, 23.7);
    assert.equal(ok.parsed_humidity, 42);
    assert.equal('parsed_density' in ok, false);
  } finally {
    server.kill();
  }
});

test('most: zalew linii (pętla restartów ESP32) jest ograniczany do jednej ramki na okno czasu', async () => {
  const sent = [];
  const stream = Readable.from([Array(1000).fill('Blad odczytu z DHT11 - sprawdz okablowanie').join('\n') + '\n']);
  const stats = runBridge(stream, { token: 't', send: async (f) => sent.push(f), minIntervalMs: 500 });
  await new Promise((r) => stream.on('end', r));
  assert.equal(sent.length, 1);
  assert.equal(stats.throttled, 999);
});
