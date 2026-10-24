// src/seed.js
import { dbOperations } from './models/db.operations.js';
import { db } from './config/database.js';
import { createHash } from 'node:crypto';

console.log('[SEED] Inicjalizacja bezpiecznego zasiewania bazy danych (WAL)...');

try {
  const seedPassword = process.env.SEED_DEFAULT_PASSWORD || 'laboratorium2026';
  const hashHasla = createHash('sha256').update(seedPassword).digest('hex');

  // ROZWIĄZANIE: Prawidłowe domknięcie metody prepare('...') oraz wywołanie .run(...)
  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('szef_admin', hashHasla, 'admin');
  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('starszy_jan', hashHasla, 'badacz_super');
  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('mlodszy_adam', hashHasla, 'badacz');
  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('audytor_kowalski', hashHasla, 'przegladajacy');

  // ROZWIĄZANIE: Prawidłowe domknięcie dla sprzętu laboratoryjnego ID = 1
  db.prepare('INSERT OR IGNORE INTO devices (id, token, name, type) VALUES (?, ?, ?, ?)').run(1, 'token_aparat_diesel_9000', 'Aparat Distyl Diesel 9000', 'legacy_print');

  console.log('[SEED] Sukces! Wszystkie brakujące relacje i role zostały pomyślnie zsynchronizowane.');
} catch (err) {
  console.error(`[SEED-ERROR] Krytyczny błąd zasiewania: ${err.message}`);
}
