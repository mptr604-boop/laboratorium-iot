// src/utils/cache.js
// Natywny cache w pamięci/SQLite z TTL i inwalidacją wzorcem SQL LIKE

import { db } from '../config/database.js';
import { createLogger } from './logger.js';

const log = createLogger('cache');
// Utworzenie tabeli cache, jeśli jeszcze nie istnieje
db.exec(`
  CREATE TABLE IF NOT EXISTS app_cache (
    cache_key TEXT PRIMARY KEY,
    cache_value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

export const redisLikeCache = {
  /**
   * Zapisuje w cache wyrenderowany HTML lub JSON
   * @param {string} key - Unikalny klucz (e.g. 'view_dashboard_page_1')
   * @param {string|Object} value - Treść do zapisania
   * @param {number} ttlMs - czas życia w milisekundach
   */
  set: (key, value, ttlMs = 5000) => {
    const expiresAt = Date.now() + ttlMs;
    const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
    
    db.prepare(`
      INSERT OR REPLACE INTO app_cache (cache_key, cache_value, expires_at)
      VALUES (?, ?, ?)
    `).run(key, serializedValue, expiresAt);
  },

  /**
   * Pobiera wartość z cache i automatycznie usuwa wygasłe wpisy
   * @param {string} key
   * @returns {string|null} Zawartość cache albo null przy braku wpisu / wygaśnięciu
   */
  get: (key) => {
    const row = db.prepare('SELECT * FROM app_cache WHERE cache_key = ?').get(key);
    if (!row) return null;

    if (Date.now() > row.expires_at) {
      db.prepare('DELETE FROM app_cache WHERE cache_key = ?').run(key);
      return null;
    }

    return row.cache_value;
  },

  /**
   * Unieważnia pojedynczy klucz albo wiele kluczy wzorcem SQL LIKE (e.g. 'view_dashboard_%')
   * @param {string} keyPattern
   */
  invalidate: (keyPattern) => {
    db.prepare('DELETE FROM app_cache WHERE cache_key LIKE ?').run(keyPattern);
    log.debug('invalidated', { pattern: keyPattern });
  }
};
