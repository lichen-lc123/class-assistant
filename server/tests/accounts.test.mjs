import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.mjs';
import { createInitialAdmin, hashPassword, verifyPassword } from '../database.mjs';
import { parseAccountText } from '../import.mjs';

test('密码使用独立盐哈希，不能直接读取原密码', async () => {
  const first = await hashPassword('FixturePass123'); const second = await hashPassword('FixturePass123');
  assert.notEqual(first, second); assert.ok(!first.includes('FixturePass123'));
  assert.equal(await verifyPassword('FixturePass123', first), true);
  assert.equal(await verifyPassword('wrong', first), false);
});
test('导入支持 BOM、Excel 制表符、前导零和 CSV 引号', () => {
  assert.deepEqual(parseAccountText('\uFEFF学号\t姓名\r\n0001\t张三'), [{ line: 1, studentId: '0001', name: '张三' }]);
  assert.equal(parseAccountText('姓名,学号\n"张,三",001')[0].name, '张,三');
  assert.equal(parseAccountText('姓名,学号\n"张,三",001')[0].studentId, '001');
  assert.throws(() => parseAccountText('学号,姓名\n001,"未闭合'), /引号/);
  assert.throws(() => parseAccountText('学号,姓名'), /没有/);
});
test('账号与权限完整流程（独立内存数据库）', async (t) => {
  const { server, db } = await createApp({ databasePath: ':memory:' });
  await createInitialAdmin(db, 'fixture-admin', '测试管理员', 'FixtureAdmin123');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, method = 'GET', body, cookie, origin = base) {
    const response = await fetch(base + '/api' + path, { method,
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const login = (studentId, password) => call('/auth/login', 'POST', { studentId, password });
  let adminCookie, studentCookie, studentId;
  await t.test('未登录与跨站请求无法管理账号', async () => {
    assert.equal((await call('/admin/users')).status, 401);
    assert.equal((await call('/auth/login', 'POST', { studentId: 'fixture-admin', password: 'FixtureAdmin123' }, undefined, 'https://untrusted.example')).status, 403);
    assert.equal((await call('/auth/login', 'POST', null)).status, 400);
  });
  await t.test('管理员真实登录，接口不返回密码或哈希', async () => {
    assert.equal((await login('fixture-admin', 'incorrect')).status, 401);
    const result = await login('fixture-admin', 'FixtureAdmin123');
    assert.equal(result.status, 200); assert.equal(result.data.role, 'admin'); adminCookie = result.cookie;
    assert.equal(JSON.stringify(result.data).includes('hash'), false);
    const listed = await call('/admin/users', 'GET', undefined, adminCookie);
    assert.equal(listed.status, 200); assert.equal(listed.data.length, 1);
    assert.equal(JSON.stringify(listed.data).includes('password_hash'), false);
    await assert.rejects(createInitialAdmin(db, 'other', '重复', 'FixtureOther123'), /已存在/);
  });
  await t.test('创建账号并拦截重复学号', async () => {
    const created = await call('/admin/users', 'POST', { studentId: '0001', name: '张三', role: 'student', password: 'FixtureStudent123' }, adminCookie);
    assert.equal(created.status, 201); studentId = created.data.id;
    assert.equal(created.data.mustChangePassword, true);
    const duplicate = await call('/admin/users', 'POST', { studentId: '0001', name: '覆盖', role: 'student', password: 'FixtureChanged123' }, adminCookie);
    assert.equal(duplicate.status, 409);
  });
  await t.test('学生首次登录必须改密，不能访问管理员接口', async () => {
    const result = await login('0001', 'FixtureStudent123'); studentCookie = result.cookie;
    assert.equal(result.status, 200);
    assert.equal((await call('/admin/users', 'GET', undefined, studentCookie)).status, 403);
    const updated = await call('/auth/password', 'POST', { oldPassword: 'FixtureStudent123', newPassword: 'FixturePersonal123' }, studentCookie);
    assert.equal(updated.status, 200); assert.equal(updated.data.mustChangePassword, false);
    assert.equal((await call('/auth/me', 'GET', undefined, studentCookie)).status, 401);
    studentCookie = updated.cookie;
    assert.equal((await call('/admin/users', 'GET', undefined, studentCookie)).status, 403);
  });
  await t.test('批量导入跳过重复，不改原密码，不擅自创建管理员', async () => {
    const imported = await call('/admin/users/import', 'POST', { text: '学号,姓名\n0001,覆盖\n0002,李四\n0002,重复\nbad id,无效', password: 'FixtureImport123' }, adminCookie);
    assert.equal(imported.status, 200); assert.equal(imported.data.created, 1);
    assert.equal(imported.data.skipped.length, 2); assert.equal(imported.data.invalid.length, 1);
    assert.equal((await login('0001', 'FixturePersonal123')).status, 200);
    assert.equal((await login('0001', 'FixtureImport123')).status, 401);
    const me = await call('/auth/me', 'GET', undefined, studentCookie); assert.equal(me.data.name, '张三');
    assert.equal(db.prepare("SELECT role FROM users WHERE student_id = '0002'").get().role, 'student');
    assert.equal(JSON.stringify(imported.data).includes('$'), false);
  });
  await t.test('编辑账号保留密码；角色变化使旧会话失效', async () => {
    const edited = await call(`/admin/users/${studentId}`, 'PATCH', { studentId: '0001', name: '张三改名', role: 'student' }, adminCookie);
    assert.equal(edited.status, 200); assert.equal(edited.data.name, '张三改名');
    assert.equal((await login('0001', 'FixturePersonal123')).status, 200);
    await call(`/admin/users/${studentId}`, 'PATCH', { studentId: '0001', name: '张三改名', role: 'admin' }, adminCookie);
    assert.equal((await call('/auth/me', 'GET', undefined, studentCookie)).status, 401);
    await call(`/admin/users/${studentId}`, 'PATCH', { studentId: '0001', name: '张三改名', role: 'student' }, adminCookie);
  });
  await t.test('重置密码立即撤销会话，旧密码不可用', async () => {
    studentCookie = (await login('0001', 'FixturePersonal123')).cookie;
    assert.equal((await call(`/admin/users/${studentId}/reset-password`, 'POST', { password: 'FixtureReset123' }, adminCookie)).status, 200);
    assert.equal((await call('/auth/me', 'GET', undefined, studentCookie)).status, 401);
    assert.equal((await login('0001', 'FixturePersonal123')).status, 401);
    const resetLogin = await login('0001', 'FixtureReset123'); assert.equal(resetLogin.status, 200); assert.equal(resetLogin.data.mustChangePassword, true); studentCookie = resetLogin.cookie;
  });
  await t.test('删除账号使所有会话和登录立即失效', async () => {
    assert.equal((await call(`/admin/users/${studentId}`, 'DELETE', undefined, adminCookie)).status, 200);
    assert.equal((await call('/auth/me', 'GET', undefined, studentCookie)).status, 401);
    assert.equal((await login('0001', 'FixtureReset123')).status, 401);
    assert.equal(db.prepare('SELECT count(*) AS count FROM sessions WHERE user_id = ?').get(studentId).count, 0);
  });
  await t.test('保护当前账号与最后一位管理员', async () => {
    const id = db.prepare("SELECT id FROM users WHERE student_id = 'fixture-admin'").get().id;
    assert.equal((await call(`/admin/users/${id}`, 'DELETE', undefined, adminCookie)).status, 400);
    assert.equal((await call(`/admin/users/${id}`, 'PATCH', { studentId: 'fixture-admin', name: '管理员', role: 'student' }, adminCookie)).status, 400);
    assert.equal((await call(`/admin/users/${id}/reset-password`, 'POST', { password: 'FixtureReset123' }, adminCookie)).status, 400);
  });
  await t.test('退出登录后会话失效', async () => {
    assert.equal((await call('/auth/logout', 'POST', {}, adminCookie)).status, 200);
    assert.equal((await call('/auth/me', 'GET', undefined, adminCookie)).status, 401);
  });
});
