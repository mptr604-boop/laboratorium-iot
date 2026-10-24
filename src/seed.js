// src/seed.js
import { dbOperations } from './models/db.operations.js';
import { db } from './config/database.js';
import { hashPassword } from './utils/password.js';

console.log('[SEED] Inicjalizacja bezpiecznego zasiewania bazy danych (WAL)...');

try {
  const seedPassword = process.env.SEED_DEFAULT_PASSWORD || 'laboratorium2026';

  // Przygotowanie zapytania i jego wykonanie
  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('szef_admin', hashPassword(seedPassword), 'admin');
  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('starszy_jan', hashPassword(seedPassword), 'badacz_super');
  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('mlodszy_adam', hashPassword(seedPassword), 'badacz');
  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('audytor_kowalski', hashPassword(seedPassword), 'przegladajacy');

  // Zasiew aparatu laboratoryjnego o ID = 1
  db.prepare('INSERT OR IGNORE INTO devices (id, token, name, type) VALUES (?, ?, ?, ?)').run(1, 'token_aparat_diesel_9000', 'Aparat Distyl Diesel 9000', 'legacy_print');

  // Zasiew czujnika klimatu: ESP32 + DHT11 (fizyczny albo symulowany, patrz src/esp32_dht11.js)
  db.prepare('INSERT OR IGNORE INTO devices (id, token, name, type) VALUES (?, ?, ?, ?)').run(2, 'token_esp32_dht11', 'ESP32 + DHT11', 'climate_sensor');

  console.log('[SEED] Sukces! Wszystkie brakujące relacje i role zostały pomyślnie zsynchronizowane.');
} catch (err) {
  console.error(`[SEED-ERROR] Krytyczny błąd zasiewania: ${err.message}`);
}
