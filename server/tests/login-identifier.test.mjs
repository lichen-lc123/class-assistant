import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {hashPassword} from '../database.mjs';

test('姓名或学号登录：精确匹配、重名保护和账号隔离', async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const password='FixtureLogin123',hash=await hashPassword(password);
  const add=(id,name,role='student')=>db.prepare('INSERT INTO users(student_id,name,role,password_hash,must_change_password) VALUES(?,?,?,?,0)').run(id,name,role,hash);
  add('0001','测试同学甲');add('0002','测试同名');add('0003','测试同名');
  add('fixture-admin','测试管理员','admin');add('0004','0001');
  async function login(identifier,pass=password){
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({studentId:identifier,password:pass})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
  }
  await t.test('学号保留前导零，去掉输入首尾空格',async()=>{
    const r=await login(' 0001 ');assert.equal(r.status,200);assert.equal(r.body.studentId,'0001');
  });
  await t.test('唯一姓名可登录，返回同一个账号且不暴露密码',async()=>{
    const r=await login(' 测试同学甲 ');assert.equal(r.status,200);assert.equal(r.body.studentId,'0001');
    assert.ok(r.cookie);assert.equal('password_hash' in r.body,false);
  });
  await t.test('重名即使密码相同也不能登录，必须使用学号',async()=>{
    const r=await login('测试同名');assert.equal(r.status,401);assert.match(r.body.message,/姓名重复.*学号/);assert.equal(r.cookie,null);
    assert.equal((await login('0002')).status,200);assert.equal((await login('0003')).status,200);
  });
  await t.test('仅完整姓名可用，错误密码和空输入不能登录',async()=>{
    for(const [name,pass] of [['测试同学',password],['测试同学甲','WrongFixture123'],['',password],['不存在的测试姓名',password]]){
      const r=await login(name,pass);assert.equal(r.status,401);assert.equal(r.cookie,null);
    }
  });
  await t.test('学号优先于其他人的同名，管理员保持原有身份',async()=>{
    assert.equal((await login('0001')).body.studentId,'0001');
    const r=await login('测试管理员');assert.equal(r.status,200);assert.equal(r.body.role,'admin');
    assert.equal((await login('FIXTURE-ADMIN')).status,200);
  });
  await t.test('修改姓名和重置密码后，旧姓名及旧密码不再登录',async()=>{
    db.prepare('UPDATE users SET name=? WHERE student_id=?').run('测试同学甲新名','0001');
    assert.equal((await login('测试同学甲')).status,401);
    assert.equal((await login('测试同学甲新名')).status,200);
    db.prepare('UPDATE users SET password_hash=? WHERE student_id=?').run(await hashPassword('FixtureNewLogin123'),'0001');
    assert.equal((await login('测试同学甲新名')).status,401);
    assert.equal((await login('测试同学甲新名','FixtureNewLogin123')).status,200);
  });
});
