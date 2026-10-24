// src/config/database.js
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const IS_DOCKER = process.env.IS_DOCKER === 'true';

const DB_DIR = IS_DOCKER 
  ? '/app/storage' 
  : path.join(process.cwd(), 'src', 'storage');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_FILE_PATH = path.join(DB_DIR, 'laboratorium.sqlite');

// Synchronizujemy i otwieramy bazę danych
export const db = new DatabaseSync(DB_FILE_PATH);

// --- PRZEMYSŁOWE ZABEZPIECZENIE PRZED BLOKOWANIEM BAZY (WAL MODE) ---
// Włączamy tryb Write-Ahead Logging oraz ustawiamy timeout na 5 sekund
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");

console.log(`[DB-CONFIG] Połączono w trybie WAL z SQLite: ${DB_FILE_PATH}`);
