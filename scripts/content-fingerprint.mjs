import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

// Store only counts and digests on the server, never account or content values.
const digest=value=>createHash('sha256').update(value).digest('hex');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
export function contentFingerprint(db){
  const tables={};
  for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'sessions' ORDER BY name").all()){
    const columns=db.prepare('PRAGMA table_info('+quote(name)+')').all().map(c=>c.name);
    const statement=db.prepare('SELECT * FROM '+quote(name));
    statement.setReadBigInts(true);
    const rows=[...statement.iterate()].map(row=>digest(JSON.stringify(columns.map(column=>{
      const value=row[column];
      return typeof value==='bigint'?['integer',String(value)]:value instanceof Uint8Array?['blob',digest(value)]:[typeof value,value];
    })))).sort();
    tables[name]={columns,count:rows.length,sha256:digest(rows.join('\n'))};
  }
  return {format:1,tables};
}
export function verifyContent(before,after){
  assert.equal(before.format,1);assert.equal(after.format,1);
  for(const [name,table] of Object.entries(before.tables))assert.deepEqual(after.tables[name],table,'Existing content changed: '+name);
  for(const [name,table] of Object.entries(after.tables))if(!Object.hasOwn(before.tables,name))assert.equal(table.count,0,'New table must start empty: '+name);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,file]=process.argv.slice(2);
  assert.ok(['snapshot','verify'].includes(mode)&&file,'Use snapshot|verify <server-only manifest>');
  assert.ok(process.env.DATABASE_PATH,'Explicit DATABASE_PATH required');
  const db=new DatabaseSync(process.env.DATABASE_PATH,{readOnly:true});
  try{
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    const current=contentFingerprint(db);
    if(mode==='snapshot')writeFileSync(file,JSON.stringify(current,null,2)+'\n',{mode:0o600});
    else verifyContent(JSON.parse(readFileSync(file,'utf8')),current);
    console.log('Content '+mode+' OK: '+Object.keys(current.tables).length+' tables; login sessions excluded.');
  }finally{db.close();}
}
