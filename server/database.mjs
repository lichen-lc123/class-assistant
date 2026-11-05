import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { initTimetableSchema } from './timetable-schema.mjs';
import { initHomeworkSchema } from './homework-schema.mjs';
import { initReminderSettingsSchema } from './reminder-settings.mjs';

const scrypt = promisify(scryptCallback);
export const publicFields = 'id, student_id AS studentId, name, role, must_change_password AS mustChangePassword, created_at AS createdAt, updated_at AS updatedAt';
export function openDatabase(path = process.env.DATABASE_PATH || 'data/homework.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student', 'admin')),
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);`);
  initTimetableSchema(db);
  initHomeworkSchema(db);
  initReminderSettingsSchema(db);
  return db;
}
export function publicUser(row) {
  return { id: row.id, studentId: row.studentId, name: row.name, role: row.role,
    mustChangePassword: Boolean(row.mustChangePassword), createdAt: row.createdAt, updatedAt: row.updatedAt };
}
export function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, hex] = encoded.split('$');
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

export async function createInitialAdmin(db, studentId, name, password) {
  if (db.prepare("SELECT id FROM users WHERE role = 'admin'").get()) throw new Error('已存在管理员，不能重复初始化。');
  if (!studentId || !name || !validPassword(password)) throw new Error('账号、姓名不能为空，密码需为 8—128 位。');
  db.prepare('INSERT INTO users (student_id, name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 0)')
    .run(studentId, name, 'admin', await hashPassword(password));
}
