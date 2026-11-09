import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createInitialAdmin } from '../server/database.mjs';

// Isolated preflight: never open the configured production database.
assert.ok(Number(process.versions.node.split('.')[0]) >= 24, '需要 Node.js 24 或更高版本。');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(resolve(process.cwd()), root, '请在项目根目录执行部署检查。');
for (const file of [
  'dist/index.html', 'dist/images/login-illustration.png', 'dist/calendar-reference-2026.png',
  '需求文档/讨论稿/课表AI解析提示词.md',
  '需求文档/课表功能/校历AI提取提示词.md',
  '需求文档/课表功能/校历示例-2026秋冬.json',
  'shared/course-week.mjs',
  'server/confirmed-schedule.mjs', 'server/reconcile-courses.mjs',
  'scripts/reconcile-courses.mjs', 'scripts/verify-production.mjs',
]) assert.ok(existsSync(resolve(root, file)), `部署文件缺失：${file}`);
const pdfRoot='dist/pdfjs/6.5.438/';
const pdfAssets=['cmaps','standard_fonts','wasm'].map(dir=>{
  const files=readdirSync(resolve(root,pdfRoot,dir));
  const file=files.find(name=>dir==='wasm'?name.endsWith('.wasm'):!name.startsWith('LICENSE'));
  assert.ok(file,`PDF 预览资源缺失：${dir}`);
  return '/pdfjs/6.5.438/'+dir+'/'+file;
});
const worker=readdirSync(resolve(root,'dist/assets')).find(name=>/^pdf\.worker.*\.mjs$/.test(name));
assert.ok(worker,'PDF 预览工作线程缺失。');

const { server, db } = await createApp({ databasePath: ':memory:', serveStatic: true });
try {
  const password = randomBytes(24).toString('hex');
  await createInitialAdmin(db, 'release-check', '部署检查临时账号', password);
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base);
  assert.equal(response.status, 200, '首页无法访问。');
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(m => m[1]);
  assert.ok(assets.some(path => path.endsWith('.js')), '首页缺少脚本。');
  assert.ok(assets.some(path => path.endsWith('.css')), '首页缺少样式。');
  for (const path of [...assets, ...pdfAssets, '/assets/'+worker, '/images/login-illustration.png', '/calendar-reference-2026.png']) {
    const file = await fetch(base + path);
    assert.equal(file.status, 200, `资源不可用：${path}`);
    assert.ok((await file.arrayBuffer()).byteLength > 0, `资源为空：${path}`);
    if(path.endsWith('.mjs'))assert.match(file.headers.get('content-type'),/javascript/,'PDF 工作线程 MIME 不正确。');
    if(path.endsWith('.wasm'))assert.equal(file.headers.get('content-type'),'application/wasm');
  }
  const unauthorized = await fetch(base + '/api/admin/users');
  assert.equal(unauthorized.status, 401, '管理接口未拦截匿名访问。');
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ studentId: 'release-check', password }),
  });
  assert.equal(login.status, 200, '临时数据库登录失败。');
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, '登录未生成会话。');
  for (const path of [
    '/api/timetable/prompt', '/api/admin/timetable/calendar-prompt',
    '/api/admin/timetable/calendar-example', '/api/timetable/terms',
    '/api/homework', '/api/reminder-settings',
  ]) {
    const result = await fetch(base + path, { headers: { Cookie: cookie } });
    assert.equal(result.status, 200, `接口不可用：${path}`);
    const body = await result.json();
    if (path.endsWith('/prompt') || path.endsWith('calendar-prompt')) assert.ok(body.text?.trim(), '提示词内容为空。');
  }
  console.log('部署程序检查通过：前端资源、提示词、登录与主要接口正常；使用独立内存数据库。');
} finally {
  if (server.listening) await new Promise(done => server.close(done));
  else server.emit('close');
}
