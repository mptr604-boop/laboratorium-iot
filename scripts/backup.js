// Backup bazy SQLite (WAL) bezpieczny podczas pracy aplikacji.
// Samo kopiowanie pliku .sqlite przy włączonym WAL może dać niespójną kopię, dlatego używamy API backup().
// Użycie: node scripts/backup.js <katalog_bazy> <katalog_backupów>
import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendJournal } from './lib/journal.js';

const RETENTION_DAYS = 14;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export async function backupDatabase(dbDir, backupDir, { environment } = {}) {
  const source = path.join(dbDir, 'laboratorium.sqlite');
  if (!fs.existsSync(source)) {
    return { skipped: true, reason: 'database file does not exist yet' };
  }

  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const target = path.join(backupDir, `${stamp}.sqlite`);

  const sourceDb = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(sourceDb, target);
  } finally {
    sourceDb.close();
  }

  // Backup bez weryfikacji to tylko nadzieja: sprawdzamy spójność kopii.
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    const result = copy.prepare('PRAGMA integrity_check').get().integrity_check;
    if (result !== 'ok') throw new Error(`integrity check failed: ${result}`);
  } catch (error) {
    fs.rmSync(target, { force: true });
    appendJournal({ action: 'backup', result: 'failed', environment, note: error.message });
    throw error;
  } finally {
    copy.close();
  }

  fs.writeFileSync(`${target}.sha256`, `${sha256(target)}  ${path.basename(target)}\n`);

  const limit = Date.now() - RETENTION_DAYS * 86_400_000;
  for (const name of fs.readdirSync(backupDir)) {
    const file = path.join(backupDir, name);
    if (/\.sqlite(\.sha256)?$/.test(name) && fs.statSync(file).mtimeMs < limit) fs.rmSync(file);
  }

  appendJournal({ action: 'backup', result: 'success', environment, note: path.basename(target) });
  return { skipped: false, file: target };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dbDir, backupDir, environment] = process.argv.slice(2);
  if (!dbDir || !backupDir) {
    console.error('Usage: node scripts/backup.js <db_dir> <backup_dir> [environment]');
    process.exit(2);
  }
  try {
    const result = await backupDatabase(dbDir, backupDir, { environment });
    console.log(result.skipped ? `Backup skipped: ${result.reason}` : `Backup saved: ${result.file}`);
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
    process.exit(1);
  }
}
