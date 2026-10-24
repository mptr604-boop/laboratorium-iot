// Przywracanie bazy z backupu. ZATRZYMAJ aplikację przed użyciem (deploy.sh restore robi to sam).
// Kolejność: weryfikacja sumy i spójności backupu -> kopia bezpieczeństwa obecnej bazy -> podmiana.
// Użycie: node scripts/restore.js <plik_backupu> <katalog_bazy> [environment]
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendJournal } from './lib/journal.js';

export function restoreDatabase(backupFile, dbDir, { environment } = {}) {
  const checksumFile = `${backupFile}.sha256`;
  if (!fs.existsSync(backupFile) || !fs.existsSync(checksumFile)) {
    throw new Error('backup file or its .sha256 is missing');
  }

  const expected = fs.readFileSync(checksumFile, 'utf8').split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex');
  if (expected !== actual) throw new Error('checksum mismatch: the backup was modified or corrupted');

  const check = new DatabaseSync(backupFile, { readOnly: true });
  try {
    const result = check.prepare('PRAGMA integrity_check').get().integrity_check;
    if (result !== 'ok') throw new Error(`integrity check failed: ${result}`);
  } finally {
    check.close();
  }

  fs.mkdirSync(dbDir, { recursive: true });
  const target = path.join(dbDir, 'laboratorium.sqlite');

  // Kopia obecnej bazy: pomyłka w wyborze backupu nie może kosztować danych.
  let safetyCopy = null;
  if (fs.existsSync(target)) {
    safetyCopy = `${target}.before-restore-${new Date().toISOString().replace(/[-:.]/g, '')}`;
    fs.copyFileSync(target, safetyCopy);
  }

  // Resztki WAL ze starej bazy nie mogą zostać zastosowane do przywróconego pliku.
  fs.rmSync(`${target}-wal`, { force: true });
  fs.rmSync(`${target}-shm`, { force: true });
  fs.copyFileSync(backupFile, target);

  appendJournal({
    action: 'restore', result: 'success', environment,
    note: `from ${path.basename(backupFile)}${safetyCopy ? `; previous database kept as ${path.basename(safetyCopy)}` : ''}`,
  });
  return { target, safetyCopy };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [backupFile, dbDir, environment] = process.argv.slice(2);
  if (!backupFile || !dbDir) {
    console.error('Usage: node scripts/restore.js <backup_file> <db_dir> [environment]');
    process.exit(2);
  }
  try {
    const { target, safetyCopy } = restoreDatabase(backupFile, dbDir, { environment });
    console.log(`Restored ${target}${safetyCopy ? ` (previous database: ${safetyCopy})` : ''}`);
  } catch (error) {
    appendJournal({ action: 'restore', result: 'failed', environment, note: error.message });
    console.error(`Restore failed: ${error.message}`);
    process.exit(1);
  }
}
