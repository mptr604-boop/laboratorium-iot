// Dziennik wdrożeń: jedna linia JSON na zdarzenie, plik tylko do dopisywania.
// Ten sam format zapisuje environment/deploy.sh, więc cały przebieg jest w jednym miejscu.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function deployRoot() {
  return process.env.DEPLOY_ROOT ?? path.resolve(import.meta.dirname, '..', '..', 'deploy_root');
}

export function journalFile() {
  return path.join(deployRoot(), 'journal.jsonl');
}

// Wpisy: { time, action, result, environment, version, user, note }. Brak pola oznacza "nie dotyczy".
export function appendJournal(entry) {
  fs.mkdirSync(deployRoot(), { recursive: true });
  const line = { time: new Date().toISOString(), user: os.userInfo().username, ...entry };
  fs.appendFileSync(journalFile(), `${JSON.stringify(line)}\n`);
}

export function readJournal(limit = 20) {
  if (!fs.existsSync(journalFile())) return [];
  return fs.readFileSync(journalFile(), 'utf8').trim().split('\n').filter(Boolean)
    .slice(-limit).map(line => JSON.parse(line));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const limit = Number(process.argv[2] ?? 20);
  for (const e of readJournal(limit)) {
    const parts = [e.time, e.action, e.result, e.environment ?? '-', e.version ?? '-', e.user ?? '-'];
    console.log(`${parts.join('  ')}${e.note ? `  # ${e.note}` : ''}`);
  }
}
