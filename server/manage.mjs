import { openDatabase, createInitialAdmin } from './database.mjs';

if (process.argv[2] !== 'init-admin') throw new Error('请使用 init-admin 初始化首位管理员。');
console.log('请通过标准输入提交初始化信息（内容不回显）：');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', async (chunk) => {
  if (chunk.includes('\u0003')) process.exit(1);
  input += chunk;
  if (!/[\r\n]/.test(input)) return;
  process.stdin.pause();
  const db = openDatabase();
  try {
    const data = JSON.parse(input.trim());
    await createInitialAdmin(db, data.studentId, data.name, data.password);
    console.log('\n管理员账号已创建。');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { input = ''; db.close(); if (process.stdin.isTTY) process.stdin.setRawMode(false); process.exit(process.exitCode || 0); }
});
