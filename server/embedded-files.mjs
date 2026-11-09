// Bounded MS-CFB reader for embedded Office/Package files; never executes payloads.
import {posix} from 'node:path';
const CFB=Buffer.from('d0cf11e0a1b11ae1','hex'),END=0xfffffffe,FREE=0xffffffff,LIMIT=16*1024*1024;
const fail=()=>{throw new Error('内嵌文件结构无法识别');};
export const attachmentName=(value,fallback='附件.bin')=>String(value||fallback).split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g,'_').slice(0,180)||fallback;
export function compoundStreams(bytes){
  if(bytes.length<512||!bytes.subarray(0,8).equals(CFB))fail();
  const version=bytes.readUInt16LE(26),shift=bytes.readUInt16LE(30),sectorSize=2**shift;
  if(!((version===3&&shift===9)||(version===4&&shift===12))||bytes.readUInt16LE(28)!==0xfffe||bytes.readUInt16LE(32)!==6)fail();
  const sectors=Math.floor(bytes.length/sectorSize)-1;
  const sector=id=>{if(!Number.isInteger(id)||id<0||id>=sectors)fail();return bytes.subarray((id+1)*sectorSize,(id+2)*sectorSize);};
  const ints=b=>Array.from({length:b.length/4},(_,i)=>b.readUInt32LE(i*4));
  const difat=ints(bytes.subarray(76,512)).filter(id=>id!==FREE),seenDif=new Set();
  let dif=bytes.readUInt32LE(68);const difCount=bytes.readUInt32LE(72),fatCount=bytes.readUInt32LE(44);
  if(difCount>sectors||fatCount>sectors)fail();
  for(let i=0;i<difCount;i++){if(seenDif.has(dif))fail();seenDif.add(dif);const list=ints(sector(dif));dif=list.pop();difat.push(...list.filter(id=>id!==FREE));}
  if(difat.length<fatCount)fail();const fat=difat.slice(0,fatCount).flatMap(id=>ints(sector(id)));
  function chain(start,table,read,size){
    if(size===0)return Buffer.alloc(0);
    const parts=[],seen=new Set();let id=start,total=0;
    while(id!==END){if(!Number.isInteger(id)||id<0||id>=table.length||seen.has(id))fail();seen.add(id);const part=read(id);total+=part.length;if(total>LIMIT)fail();parts.push(part);id=table[id];}
    if(size!=null&&total<size)fail();return Buffer.concat(parts).subarray(0,size??total);
  }
  const directory=chain(bytes.readUInt32LE(48),fat,sector),entries=[];
  for(let at=0;at+128<=directory.length;at+=128){const b=directory.subarray(at,at+128),type=b[66],len=b.readUInt16LE(64);if(!type)continue;if(len<2||len>64||len%2)fail();const size=Number(b.readBigUInt64LE(120));if(!Number.isSafeInteger(size)||size>LIMIT)fail();entries.push({name:b.subarray(0,len-2).toString('utf16le'),type,start:b.readUInt32LE(116),size});}
  const root=entries.find(e=>e.type===5);if(!root)fail();
  const miniRoot=chain(root.start,fat,sector,root.size),miniCount=bytes.readUInt32LE(64);
  if(miniCount>sectors||bytes.readUInt32LE(56)!==4096)fail();
  const miniFat=miniCount?ints(chain(bytes.readUInt32LE(60),fat,sector,miniCount*sectorSize)):[];
  const mini=id=>{if(id*64+64>miniRoot.length)fail();return miniRoot.subarray(id*64,id*64+64);};
  const result=new Map();
  for(const e of entries)if(e.type===2){if(result.has(e.name))fail();result.set(e.name,e.size<4096?chain(e.start,miniFat,mini,e.size):chain(e.start,fat,sector,e.size));}
  return result;
}
const ansi=b=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{return new TextDecoder('gb18030').decode(b);}};
export function nativePackage(stream){
  if(stream.length<10)fail();const total=stream.readUInt32LE(0);if(total>stream.length-4)fail();let at=6;
  if(stream.readUInt16LE(4)!==2)fail();
  const take=n=>{if(n<0||at+n>total+4)fail();const data=stream.subarray(at,at+n);at+=n;return data;};
  const zstr=()=>{const end=stream.indexOf(0,at);if(end<at||end-at>4096)fail();return ansi(take(end-at+1).subarray(0,-1));};
  const label=zstr(),path=zstr();take(4);
  const commandSize=take(4).readUInt32LE();if(commandSize>4096)fail();take(commandSize);
  const length=take(4).readUInt32LE();if(!length||length>10*1024*1024)fail();const content=take(length);
  let filename=attachmentName(path||label);
  // Newer Package2 objects can carry the original Unicode filename after the data.
  if(at+4<=total+4&&stream.readUInt16LE(at)!==0){try{const unicode=()=>{const n=take(4).readUInt32LE();if(n>2048)fail();return take(n*2).toString('utf16le').replace(/\0+$/,'');};unicode();unicode();const name=unicode();if(name)filename=attachmentName(name);}catch{/* ANSI filename remains usable. */}}
  return {filename,bytes:content};
}
export function extractEmbeddedFile(bytes,target,progId=''){
  if(!bytes?.length)fail();
  if(bytes.subarray(0,8).equals(CFB)){
    const streams=new Map([...compoundStreams(bytes)].map(([name,value])=>[name.toLowerCase(),value]));
    const native=streams.get('\u0001ole10native');if(native)return nativePackage(native);
    const contents=streams.get('contents');
    if(contents?.subarray(0,5).toString()==='%PDF-')return{filename:attachmentName(target).replace(/\.bin$/i,'.pdf'),bytes:contents};
    const packageData=streams.get('package');if(packageData)return{filename:attachmentName(target).replace(/\.bin$/i,/Word/i.test(progId)?'.docx':/Excel/i.test(progId)?'.xlsx':/PowerPoint/i.test(progId)?'.pptx':'.zip'),bytes:packageData};
    const ext=streams.has('worddocument')?'.doc':streams.has('workbook')||streams.has('book')?'.xls':streams.has('powerpoint document')?'.ppt':null;
    if(ext)return{filename:attachmentName(target).replace(/\.bin$/i,ext),bytes};
    fail();
  }
  if(/\.bin$/i.test(target)){
    if(bytes.subarray(0,5).toString()==='%PDF-')return{filename:attachmentName(target).replace(/\.bin$/i,'.pdf'),bytes};
    fail();
  }
  return{filename:attachmentName(posix.basename(target)),bytes};
}
