import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const source = resolve(process.env.DATABASE_PATH || 'data/homework.sqlite');
if (!existsSync(source)) throw new Error('数据库不存在，未创建空数据库。');
const outputDirectory = resolve(process.argv[2] || join(dirname(source), 'backups'));
mkdirSync(outputDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = join(outputDirectory, `homework-${stamp}.sqlite`);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  console.log(`数据库一致性备份已保存：${destination}`);
} finally {
  db.close();
}
