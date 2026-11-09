import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {contentFingerprint,verifyContent} from '../../scripts/content-fingerprint.mjs';

test('程序发布核对全部内容及附件字节，允许空新表与登录会话续期，阻止覆盖或删除',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE content(id INTEGER PRIMARY KEY,value TEXT,file BLOB);CREATE TABLE sessions(token TEXT,expires_at INTEGER);');
    db.prepare('INSERT INTO content VALUES(?,?,?)').run(1,'服务器维护的内容',Buffer.from('original document'));
    db.exec("INSERT INTO sessions VALUES('test',123)");
    const before=contentFingerprint(db);
    db.exec('UPDATE sessions SET expires_at=0;CREATE TABLE new_policy(record_id TEXT);');
    verifyContent(before,contentFingerprint(db));
    db.prepare('UPDATE content SET file=?').run(Buffer.from('changed document'));
    assert.throws(()=>verifyContent(before,contentFingerprint(db)),/Existing content changed/);
    db.prepare('UPDATE content SET file=?').run(Buffer.from('original document'));
    db.exec("INSERT INTO new_policy VALUES('unexpected-default')");
    assert.throws(()=>verifyContent(before,contentFingerprint(db)),/New table must start empty/);
    db.exec('DELETE FROM new_policy;DELETE FROM content');
    assert.throws(()=>verifyContent(before,contentFingerprint(db)),/Existing content changed/);
  }finally{db.close();}
});
