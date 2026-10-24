// src/utils/cache.js
// Native in-memory/SQLite cache engine with TTL and SQL LIKE pattern invalidation

import { db } from '../config/database.js';

// Initialize cache table schema if not already present
db.exec(`
  CREATE TABLE IF NOT EXISTS app_cache (
    cache_key TEXT PRIMARY KEY,
    cache_value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

export const redisLikeCache = {
  /**
   * Stores rendered HTML or JSON payload in cache
   * @param {string} key - Unique key identifier (e.g. 'view_dashboard_page_1')
   * @param {string|Object} value - Content to cache
   * @param {number} ttlMs - Time-To-Live in milliseconds
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
   * Retrieves value from cache, automatically evicting expired entries
   * @param {string} key
   * @returns {string|null} Cached content or null on cache miss / expiration
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
   * Invalidates single key or bulk matches using SQL LIKE wildcard (e.g. 'view_dashboard_%')
   * @param {string} keyPattern
   */
  invalidate: (keyPattern) => {
    db.prepare('DELETE FROM app_cache WHERE cache_key LIKE ?').run(keyPattern);
    console.log(`[CACHE-INVALIDATE] Cache invalidated for pattern: ${keyPattern}`);
  }
};
