import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress } from '../client-address.mjs';
import { createApp } from '../app.mjs';
import { createInitialAdmin } from '../database.mjs';

test('仅显式信任本机代理，外部来源与伪造地址不能覆盖登录限流地址', () => {
  const request = (peer, value) => ({ socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': value } });
  assert.equal(clientAddress(request('127.0.0.1', '198.51.100.1')), '127.0.0.1');
  assert.equal(clientAddress(request('198.51.100.2', '198.51.100.1'), true), '198.51.100.2');
  assert.equal(clientAddress(request('127.0.0.1', '198.51.100.1'), true), '198.51.100.1');
  assert.equal(clientAddress(request('::ffff:127.0.0.1', '2001:db8::1'), true), '2001:db8::1');
  for (const value of ['', 'invalid', '198.51.100.1, 198.51.100.2', ['198.51.100.1']]) {
    assert.equal(clientAddress(request('127.0.0.1', value), true), '127.0.0.1');
  }
});

test('本机网关后的不同用户分别限流，一人的错误登录不锁住其他人', async t => {
  const { server, db } = await createApp({ databasePath: ':memory:', trustLoopbackProxy: true });
  await createInitialAdmin(db, 'proxy-fixture', '测试', 'FixturePassword123');
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (address, password) => fetch(base + '/api/auth/login', {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Forwarded-For': address },
    body: JSON.stringify({ studentId: 'proxy-fixture', password }),
  });
  for (let i = 0; i < 15; i++) assert.equal((await login('198.51.100.1', 'incorrect')).status, 401);
  assert.equal((await login('198.51.100.1', 'FixturePassword123')).status, 429);
  assert.equal((await login('198.51.100.2', 'FixturePassword123')).status, 200);
});
