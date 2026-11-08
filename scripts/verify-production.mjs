import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const expected=process.argv[2],base='http://127.0.0.1:3001';
assert.match(expected||'',/^[a-f0-9]{40}$/);
assert.equal(JSON.parse(readFileSync(resolve('RELEASE.json'))).revision,expected);
let home;
for(let i=0;i<30;i++){try{home=await fetch(base);if(home.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
assert.equal(home?.status,200,'Homepage unavailable');
const html=await home.text();assert.match(html,/MEM2602/);
for(const match of html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g))assert.equal((await fetch(base+match[1])).status,200);
assert.equal((await fetch(base+'/api/admin/users')).status,401);
const db=new DatabaseSync(process.env.DATABASE_PATH||'/var/lib/homework/homework.sqlite');
try{
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  const users=['admin','student'].map(role=>db.prepare('SELECT id,role FROM users WHERE role=? AND must_change_password=0 ORDER BY id LIMIT 1').get(role)).filter(Boolean);
  assert.ok(users.some(user=>user.role==='admin'),'No existing administrator');
  for(const user of users){
    const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash,user.id,Date.now()+60000);
    try{
      for(const path of ['/api/auth/me','/api/timetable/terms','/api/timetable/dashboard','/api/timetable/dashboard?view=mobile','/api/homework','/api/homework/summary','/api/homework/courses']){
        const response=await fetch(base+path,{headers:{Cookie:'session='+token}});assert.equal(response.status,200,user.role+': '+path);await response.json();
      }
      assert.equal((await fetch(base+'/api/admin/users',{headers:{Cookie:'session='+token}})).status,user.role==='admin'?200:403);
      console.log('Existing '+user.role+' read endpoints and permissions OK.');
    }finally{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);}
  }
  console.log('Production release, assets, database integrity and authenticated APIs OK.');
}finally{db.close();}
