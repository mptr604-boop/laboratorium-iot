// Testy wdrożeń: dziennik, backup przed zmianą, rollback i przywracanie bazy.
// Docker jest podmieniony atrapą w PATH, więc test nie dotyka prawdziwych kontenerów.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase } from '../../scripts/backup.js';
import { restoreDatabase } from '../../scripts/restore.js';

const DEPLOY_SCRIPT = path.resolve(import.meta.dirname, '..', '..', 'environment', 'deploy.sh');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-deploy-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh\necho "$* STORAGE_DIR=$STORAGE_DIR NODE_ENV=$NODE_ENV" >> "${root}/docker.log"\n`,
    { mode: 0o755 },
  );
  return { root, deployRoot: path.join(root, 'deploy_root') };
}

function deploy(ctx, ...args) {
  return spawnSync('bash', [DEPLOY_SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DEPLOY_ROOT: ctx.deployRoot, PATH: `${path.join(ctx.root, 'bin')}:${process.env.PATH}` },
  });
}

function journal(ctx) {
  const file = path.join(ctx.deployRoot, 'journal.jsonl');
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

function seedDatabase(dbDir, rows) {
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, 'laboratorium.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)');
  for (let i = 0; i < rows; i++) db.prepare('INSERT INTO t (v) VALUES (?)').run(`row-${i}`);
  return db;
}

const count = dbDir => {
  const db = new DatabaseSync(path.join(dbDir, 'laboratorium.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT COUNT(*) AS n FROM t').get().n; } finally { db.close(); }
};

test('production deploy: backs up first, starts only production, switches current, writes the journal', () => {
  const ctx = makeRoot();
  const dbDir = path.join(ctx.deployRoot, 'storage', 'production');
  const db = seedDatabase(dbDir, 3);

  const result = deploy(ctx, 'production', 'v1');
  db.close();
  assert.equal(result.status, 0, result.stderr);

  assert.equal(fs.readlinkSync(path.join(ctx.deployRoot, 'current')), path.join(ctx.deployRoot, 'releases', 'v1'));
  const dockerLog = fs.readFileSync(path.join(ctx.root, 'docker.log'), 'utf8');
  assert.match(dockerLog, /up -d --build lab-app-production/);
  assert.ok(dockerLog.includes(`STORAGE_DIR=${dbDir}`), 'production uses its own data directory');
  assert.doesNotMatch(dockerLog, /lab-app-staging/);

  const backups = fs.readdirSync(path.join(ctx.deployRoot, 'backups', 'production'));
  assert.equal(backups.filter(f => f.endsWith('.sqlite')).length, 1);
  assert.equal(backups.filter(f => f.endsWith('.sha256')).length, 1);

  const entries = journal(ctx);
  assert.deepEqual(entries.map(e => `${e.action}:${e.result}`), ['backup:success', 'production:success']);
  assert.equal(entries[1].version, 'v1');
  assert.equal(entries[1].note, 'previous=none');
  fs.rmSync(ctx.root, { recursive: true });
});

test('production deploy refuses an existing version and records the failure', () => {
  const ctx = makeRoot();
  assert.equal(deploy(ctx, 'production', 'v1').status, 0);
  const again = deploy(ctx, 'production', 'v1');
  assert.equal(again.status, 1);
  const last = journal(ctx).at(-1);
  assert.equal(last.result, 'failed');
  assert.match(last.note, /already exists/);
  fs.rmSync(ctx.root, { recursive: true });
});

test('rollback: records the reason, takes a backup first and states that the database is not rolled back', () => {
  const ctx = makeRoot();
  const db = seedDatabase(path.join(ctx.deployRoot, 'storage', 'production'), 2);
  assert.equal(deploy(ctx, 'production', 'v1').status, 0);
  assert.equal(deploy(ctx, 'production', 'v2').status, 0);

  const result = deploy(ctx, 'rollback', 'v1', 'errors after v2 release');
  db.close();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readlinkSync(path.join(ctx.deployRoot, 'current')), path.join(ctx.deployRoot, 'releases', 'v1'));

  const rollbackEntry = journal(ctx).at(-1);
  assert.equal(rollbackEntry.action, 'rollback');
  assert.equal(rollbackEntry.result, 'success');
  assert.match(rollbackEntry.note, /errors after v2 release/);
  assert.match(rollbackEntry.note, /database was NOT rolled back/);
  const actions = journal(ctx).map(e => e.action);
  assert.equal(actions.at(-2), 'backup');
  fs.rmSync(ctx.root, { recursive: true });
});

test('rollback to an unknown version fails without touching anything', () => {
  const ctx = makeRoot();
  const result = deploy(ctx, 'rollback', 'v404');
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(ctx.deployRoot, 'current')), false);
  assert.equal(journal(ctx).at(-1).result, 'failed');
  fs.rmSync(ctx.root, { recursive: true });
});

test('backup taken while the app holds an uncheckpointed WAL is complete and verified', async () => {
  const ctx = makeRoot();
  const dbDir = path.join(ctx.root, 'db');
  const db = seedDatabase(dbDir, 5);
  process.env.DEPLOY_ROOT = ctx.deployRoot;

  const result = await backupDatabase(dbDir, path.join(ctx.root, 'bk'), { environment: 'test' });
  db.close();
  assert.equal(result.skipped, false);
  const copy = new DatabaseSync(result.file, { readOnly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM t').get().n, 5);
  copy.close();
  fs.rmSync(ctx.root, { recursive: true });
});

test('restore returns the database to the backed-up state and keeps a safety copy', async () => {
  const ctx = makeRoot();
  const dbDir = path.join(ctx.root, 'db');
  process.env.DEPLOY_ROOT = ctx.deployRoot;
  const db = seedDatabase(dbDir, 4);
  const { file } = await backupDatabase(dbDir, path.join(ctx.root, 'bk'));

  db.exec("INSERT INTO t (v) VALUES ('bad-row-1'), ('bad-row-2')");
  db.close();
  assert.equal(count(dbDir), 6);

  const { safetyCopy } = restoreDatabase(file, dbDir);
  assert.equal(count(dbDir), 4);
  assert.ok(safetyCopy && fs.existsSync(safetyCopy), 'previous database is kept');
  fs.rmSync(ctx.root, { recursive: true });
});

test('restore refuses a tampered backup and leaves the database untouched', async () => {
  const ctx = makeRoot();
  const dbDir = path.join(ctx.root, 'db');
  process.env.DEPLOY_ROOT = ctx.deployRoot;
  const db = seedDatabase(dbDir, 3);
  const { file } = await backupDatabase(dbDir, path.join(ctx.root, 'bk'));
  db.close();

  fs.appendFileSync(file, 'tampered');
  assert.throws(() => restoreDatabase(file, dbDir), /checksum mismatch/);
  assert.equal(count(dbDir), 3);
  fs.rmSync(ctx.root, { recursive: true });
});

test('journal command prints recorded events', () => {
  const ctx = makeRoot();
  assert.equal(deploy(ctx, 'production', 'v1').status, 0);
  const output = deploy(ctx, 'journal');
  assert.equal(output.status, 0);
  assert.match(output.stdout, /production\s+success\s+production\s+v1/);
  fs.rmSync(ctx.root, { recursive: true });
});
