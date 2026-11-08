import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { openDatabase, publicFields, publicUser, hashPassword, verifyPassword, validPassword, tokenHash } from './database.mjs';
import { parseAccountText } from './import.mjs';
import { timetableService } from './timetable.mjs';
import { homeworkService } from './homework.mjs';
import { reminderSettingsService } from './reminder-settings.mjs';
import { clientAddress } from './client-address.mjs';

const SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;
const SESSION_RENEW_INTERVAL = 24 * 60 * 60 * 1000;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
function validateAccount(studentId, name, role) {
  if (typeof studentId !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(studentId)) fail(400, '学号需为 1—40 位字母、数字、下划线或短横线。');
  if (typeof name !== 'string' || !name.trim() || name.length > 60) fail(400, '姓名不能为空，且不能超过 60 个字符。');
  if (!['student', 'admin'].includes(role)) fail(400, '请选择有效角色。');
}
async function readJson(req, limit = 1024 * 1024) {
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, '提交内容过大。'); chunks.push(chunk); }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '提交格式不正确。');
    return body;
  } catch { fail(400, '提交格式不正确。'); }
}
export async function createApp({ databasePath, serveStatic = false, allowedOrigins = [], trustLoopbackProxy = false } = {}) {
  const db = openDatabase(databasePath);
  const timetable = timetableService(db);
  const homework = homeworkService(db,timetable);
  const reminderSettings = reminderSettingsService(db);
  const dummyHash = await hashPassword(randomBytes(24).toString('hex'));
  const attempts = new Map();
  const cleanup = setInterval(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    for (const [key, item] of attempts) if (item.until <= Date.now()) attempts.delete(key);
  }, 60000);
  cleanup.unref();
  const findUser = (id) => db.prepare(`SELECT ${publicFields} FROM users WHERE id = ?`).get(id);
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('session='))?.slice(8);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const key = tokenHash(token);
    const row = db.prepare(`SELECT ${publicFields.replaceAll(/\b(id|name|role|created_at|updated_at|student_id|must_change_password)\b/g, 'users.$1')}, sessions.expires_at AS sessionExpiresAt FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?`).get(key, Date.now());
    return row ? { user: publicUser(row), key, token, expiresAt: row.sessionExpiresAt } : null;
  }
  function resolveLogin(identifier) {
    // Student IDs remain unambiguous even when another account has the same name.
    const account = db.prepare('SELECT * FROM users WHERE student_id = ?').get(identifier);
    if (account) return { record: account, ambiguous: false };
    const names = db.prepare('SELECT * FROM users WHERE name = ? LIMIT 2').all(identifier);
    return { record: names.length === 1 ? names[0] : undefined, ambiguous: names.length > 1 };
  }
  function sessionCookie(res, token) {
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_LIFETIME / 1000}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
  }
  function setSession(res, userId) {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash(token), userId, Date.now() + SESSION_LIFETIME);
    sessionCookie(res, token);
  }
  function clearCookie(res) { res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); }
  const timestamp = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (!path.startsWith('/api/')) {
        if (!serveStatic || !['GET', 'HEAD'].includes(req.method)) fail(404, '页面不存在。');
        const base = resolve('dist');
        const requested = resolve(base, '.' + decodeURIComponent(path));
        if (requested !== base && !requested.startsWith(base + sep)) fail(404, '页面不存在。');
        const file = path === '/' ? resolve(base, 'index.html') : requested;
        if (!existsSync(file)) fail(404, '页面不存在。');
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : readFileSync(file)); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.origin;
        if (!origin || ![...allowedOrigins, `http://${req.headers.host}`, `https://${req.headers.host}`].includes(origin)) fail(403, '请求来源无效，请刷新页面重试。');
        if (!req.headers['content-type']?.startsWith('application/json')) fail(415, '请使用 JSON 格式提交。');
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        const body = await readJson(req);
        const identifier = typeof body.studentId === 'string' ? body.studentId.trim() : '';
        const rateKey = clientAddress(req, trustLoopbackProxy);
        const rate = attempts.get(rateKey);
        if (rate && rate.until > Date.now() && rate.count >= 15) fail(429, '尝试次数过多，请 15 分钟后重试。');
        const { record, ambiguous } = resolveLogin(identifier);
        const valid = await verifyPassword(body.password, record?.password_hash || dummyHash);
        // Re-check the identifier after hashing: account edits, resets and newly duplicated names invalidate this attempt.
        const resolved = resolveLogin(identifier);
        const current = resolved.record;
        if (!valid || !current || current.id !== record?.id || current.password_hash !== record?.password_hash) {
          const latest = attempts.get(rateKey);
          const previous = latest && latest.until > Date.now() ? latest : { count: 0, until: Date.now() + 15 * 60000 };
          attempts.set(rateKey, { ...previous, count: previous.count + 1 }); fail(401, ambiguous || resolved.ambiguous ? '姓名重复，请使用学号登录。' : '姓名、学号或密码不正确。');
        }
        attempts.delete(rateKey);
        const oldSession = session(req); if (oldSession) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(oldSession.key);
        setSession(res, record.id); send(200, publicUser(findUser(record.id))); return;
      }
      const active = session(req);
      if (!active) { clearCookie(res); fail(401, '登录已失效，请重新登录。'); }
      // Renew at most once a day, including existing shorter sessions. Revoked or expired sessions never reach this branch.
      if (active.expiresAt <= Date.now() + SESSION_LIFETIME - SESSION_RENEW_INTERVAL) {
        db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + SESSION_LIFETIME, active.key);
        sessionCookie(res, active.token);
      }
      const { user } = active;
      if (path === '/api/auth/me' && req.method === 'GET') { send(200, user); return; }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(active.key); clearCookie(res); send(200, { ok: true }); return;
      }
      if (path === '/api/auth/password' && req.method === 'POST') {
        const body = await readJson(req);
        if (typeof body.newPassword!=='string'||!/^(?=.*[A-Za-z])(?=.*[0-9])[^\s]{8,32}$/.test(body.newPassword)) fail(400, '新密码需为 8—32 位，包含字母和数字，可使用符号，不含空格。');
        if (body.oldPassword === body.newPassword) fail(400, '新密码不能与原密码相同。');
        const original = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
        if (!await verifyPassword(body.oldPassword, original.password_hash)) fail(400, '当前密码不正确。');
        const hash = await hashPassword(body.newPassword);
        const current = session(req);
        if (!current || db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id)?.password_hash !== original.password_hash) fail(401, '登录已失效，请重新登录。');
        db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ${timestamp} WHERE id = ?`).run(hash, user.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
        setSession(res, user.id); send(200, publicUser(findUser(user.id))); return;
      }
      if (user.mustChangePassword) fail(403, '请先修改初始密码。');
      if (path === '/api/reminder-settings') {
        await reminderSettings.handle({req,user,readJson,send,getSession:()=>session(req)});return;
      }
      if (path==='/api/homework'||path==='/api/admin/homework'||path.startsWith('/api/homework/')||path.startsWith('/api/admin/homework/')) {
        await homework.handle({req,path,url,user,readJson,send,getSession:()=>session(req),res});return;
      }
      if (path.startsWith('/api/timetable/') || path.startsWith('/api/admin/timetable/')) {
        await timetable.handle({req,path,url,user,readJson,send,getSession:()=>session(req)});return;
      }
      if (!path.startsWith('/api/admin/')) fail(404, '接口不存在。');
      if (user.role !== 'admin') fail(403, '仅管理员可以操作。');
      if (path === '/api/admin/users' && req.method === 'GET') {
        const search = (url.searchParams.get('search') || '').slice(0, 100);
        send(200, db.prepare(`SELECT ${publicFields} FROM users WHERE student_id LIKE ? OR name LIKE ? ORDER BY id DESC`).all(`%${search}%`, `%${search}%`).map(publicUser)); return;
      }
      if (path === '/api/admin/users' && req.method === 'POST') {
        const body = await readJson(req);
        const studentId = body.studentId?.trim(), name = body.name?.trim();
        validateAccount(studentId, name, body.role);
        if (!validPassword(body.password)) fail(400, '初始密码需为 8—128 位。');
        const hash = await hashPassword(body.password);
        if (session(req)?.user.role !== 'admin') fail(403, '管理权限已失效。');
        const result = db.prepare('INSERT INTO users (student_id, name, role, password_hash) VALUES (?, ?, ?, ?)').run(studentId, name, body.role, hash);
        send(201, publicUser(findUser(Number(result.lastInsertRowid)))); return;
      }
      if (path === '/api/admin/users/import' && req.method === 'POST') {
        const body = await readJson(req);
        if (!validPassword(body.password)) fail(400, '统一初始密码需为 8—128 位。');
        const rows = parseAccountText(body.text);
        const seen = new Set(); const ready = []; const skipped = []; const invalid = [];
        for (const row of rows) {
          try { validateAccount(row.studentId, row.name, 'student'); } catch (error) { invalid.push({ ...row, reason: error.message }); continue; }
          const key = row.studentId.toLowerCase();
          if (seen.has(key) || db.prepare('SELECT id FROM users WHERE student_id = ?').get(row.studentId)) {
            skipped.push({ ...row, reason: '学号已存在，未覆盖账号或密码' }); continue;
          }
          seen.add(key); ready.push({ ...row, hash: await hashPassword(body.password) });
        }
        if (session(req)?.user.role !== 'admin') fail(403, '管理权限已失效。');
        let created = 0;
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const row of ready) {
            const result = db.prepare("INSERT OR IGNORE INTO users (student_id, name, role, password_hash) VALUES (?, ?, 'student', ?)").run(row.studentId, row.name, row.hash);
            if (result.changes) created++; else skipped.push({ studentId: row.studentId, name: row.name, line: row.line, reason: '学号已存在，未覆盖账号或密码' });
          }
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        send(200, { created, skipped, invalid }); return;
      }
      const match = path.match(/^\/api\/admin\/users\/(\d+)(\/reset-password)?$/);
      if (!match) fail(404, '接口不存在。');
      const id = Number(match[1]);
      const target = findUser(id);
      if (!target) fail(404, '账号不存在。');
      const lastAdmin = target.role === 'admin' && db.prepare("SELECT count(*) AS count FROM users WHERE role = 'admin'").get().count <= 1;
      if (match[2] && req.method === 'POST') {
        if (id === user.id) fail(400, '请使用“修改密码”修改自己的密码。');
        const body = await readJson(req);
        if (!validPassword(body.password)) fail(400, '临时密码需为 8—128 位。');
        const hash = await hashPassword(body.password);
        if (session(req)?.user.role !== 'admin') fail(403, '管理权限已失效。');
        db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ${timestamp} WHERE id = ?`).run(hash, id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); send(200, { ok: true }); return;
      }
      if (!match[2] && req.method === 'PATCH') {
        const body = await readJson(req); const studentId = body.studentId?.trim(), name = body.name?.trim();
        if (session(req)?.user.role !== 'admin') fail(403, '管理权限已失效。');
        validateAccount(studentId, name, body.role);
        if (body.role !== 'admin' && findUser(id)?.role === 'admin' && db.prepare("SELECT count(*) AS count FROM users WHERE role = 'admin'").get().count <= 1) fail(400, '至少需要保留一位管理员。');
        db.prepare(`UPDATE users SET student_id = ?, name = ?, role = ?, updated_at = ${timestamp} WHERE id = ?`).run(studentId, name, body.role, id);
        if (target.role !== body.role || target.studentId !== studentId) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        send(200, publicUser(findUser(id))); return;
      }
      if (!match[2] && req.method === 'DELETE') {
        if (id === user.id) fail(400, '不能删除当前登录账号。');
        if (lastAdmin) fail(400, '至少需要保留一位管理员。');
        db.prepare('DELETE FROM users WHERE id = ?').run(id); send(200, { ok: true }); return;
      }
      fail(405, '不支持此操作。');
    } catch (error) {
      const conflict = error.code?.startsWith('ERR_SQLITE') && error.message?.includes('UNIQUE');
      const status = error.status || (conflict ? 409 : 500);
      send(status, { message: error.status ? error.message : conflict ? '学号已存在，请使用其他学号。' : '操作暂时失败，请稍后重试。' });
    }
  });
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return { server, db };
}
