import { inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';
import { problem, trim, validDate } from './schedule.mjs';

const u16=(b,o=0)=>b.readUInt16LE(o),u32=(b,o=0)=>b.readUInt32LE(o);
function xlsSheets(buffer) {
  const b=buffer;
  if(b.length<512) problem('XLS 文件不完整。');
  const size=2**u16(b,30),miniSize=2**u16(b,32);
  if(![512,4096].includes(size)) problem('不支持此 XLS 版本，请另存为 XLSX。');
  const sector=n=>{const from=(n+1)*size;if(from<0||from+size>b.length)problem('XLS 文件结构损坏。');return b.subarray(from,from+size);};
  let fat=[];
  const difat=[];for(let i=0;i<109;i++){const n=u32(b,76+i*4);if(n<0xfffffffa)difat.push(n);}
  let next=u32(b,68);
  for(let i=0;i<Math.min(u32(b,72),100)&&next<0xfffffffa;i++){const s=sector(next);for(let j=0;j<size/4-1;j++){const n=u32(s,j*4);if(n<0xfffffffa)difat.push(n);}next=u32(s,size-4);}
  for(const n of difat){const s=sector(n);for(let i=0;i<size;i+=4)fat.push(u32(s,i));}
  const chain=(start,table)=>{const result=[],seen=new Set();let n=start;while(n<0xfffffffa){if(n>=table.length||seen.has(n)||result.length>10000)problem('XLS 存储链损坏。');seen.add(n);result.push(n);n=table[n];}return result;};
  const directory=Buffer.concat(chain(u32(b,48),fat).map(sector));
  const entries=[];
  for(let o=0;o+128<=directory.length;o+=128){const e=directory.subarray(o,o+128),len=u16(e,64);if(len>=2&&len<=64)entries.push({name:e.subarray(0,len-2).toString('utf16le'),type:e[66],start:u32(e,116),size:Number(e.readBigUInt64LE(120))});}
  const root=entries.find(e=>e.type===5),book=entries.find(e=>['Workbook','Book'].includes(e.name));
  if(!root||!book||book.size>16*1024*1024)problem('未找到可读取的工作表。');
  let data;
  if(book.size>=u32(b,56)) data=Buffer.concat(chain(book.start,fat).map(sector)).subarray(0,book.size);
  else{
    const mini=Buffer.concat(chain(root.start,fat).map(sector)).subarray(0,root.size);
    const miniFatBytes=Buffer.concat(chain(u32(b,60),fat).map(sector));const miniFat=[];
    for(let i=0;i<miniFatBytes.length;i+=4)miniFat.push(u32(miniFatBytes,i));
    data=Buffer.concat(chain(book.start,miniFat).map(n=>mini.subarray(n*miniSize,(n+1)*miniSize))).subarray(0,book.size);
  }
  const records=[];
  for(let o=0;o+4<=data.length;){const code=u16(data,o),len=u16(data,o+2);if(!code&&!len)break;if(o+4+len>data.length)problem('XLS 记录不完整。');if(code===0x002f)problem('加密文件请先在 Excel 中解密并另存。');records.push({offset:o,code,data:data.subarray(o+4,o+4+len)});o+=4+len;}
  const text=(s,o,small=false)=>{
    if(o+(small?2:3)>s.length)problem('XLS 字符串跨记录，请另存为 XLSX 后导入。');
    const count=small?s[o]:u16(s,o);o+=small?1:2;const flags=s[o++];let rich=0,ext=0;
    if(flags&8){rich=u16(s,o);o+=2;}if(flags&4){ext=u32(s,o);o+=4;}
    const length=count*(flags&1?2:1);if(o+length>s.length)problem('此 XLS 含跨记录长文本，请另存为 XLSX 后导入，避免截断资料。');
    return [s.subarray(o,o+length).toString(flags&1?'utf16le':'latin1'),o+length+rich*4+ext];
  };
  const strings=[],sheets=[];
  for(const r of records){if(r.code===0xfc){const total=u32(r.data,4);if(total>100000)problem('XLS 字符串过多。');let p=8;for(let i=0;i<total;i++){const [s,n]=text(r.data,p);strings.push(s);p=n;}}if(r.code===0x85){const [name]=text(r.data,6,true);sheets.push({name,offset:u32(r.data),rows:[]});}}
  const rk=n=>{const bytes=Buffer.alloc(8);bytes.writeUInt32LE((n&0xfffffffc)>>>0,4);let value=n&2?(n|0)>>2:bytes.readDoubleLE();return n&1?value/100:value;};
  for(const sheet of sheets)for(const r of records){
    if(r.offset<sheet.offset)continue;if(r.code===0xa)break;
    if([0xfd,0x203,0x27e,0x204].includes(r.code)){
      const row=u16(r.data),col=u16(r.data,2);if(row>10000||col>100)problem('课表范围过大。');
      const value=r.code===0xfd?strings[u32(r.data,6)]:r.code===0x203?r.data.readDoubleLE(6):r.code===0x27e?rk(u32(r.data,6)):text(r.data,6)[0];
      sheet.rows[row]||=[];sheet.rows[row][col]=value;
    }else if(r.code===0xbd){const row=u16(r.data),first=u16(r.data,2),last=u16(r.data,r.data.length-2);if(last>100||row>10000)problem('课表范围过大。');sheet.rows[row]||=[];for(let col=first;col<=last;col++)sheet.rows[row][col]=rk(u32(r.data,6+(col-first)*6));}
  }
  return sheets;
}
const decode=s=>String(s||'').replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const attr=(xml,key)=>decode(xml.match(new RegExp('(?:^|\\s)'+key+'=["\x27]([^"\x27]*)["\x27]'))?.[1]||'');
const texts=xml=>[...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g,'').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join('');
function xlsxSheets(b){
  let eocd=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65558);i--)if(u32(b,i)===0x06054b50){eocd=i;break;}
  if(eocd<0)problem('XLSX 压缩结构不完整。');
  const entries=new Map();let offset=u32(b,eocd+16),total=0;
  const count=u16(b,eocd+10);if(count>2000)problem('文件内容过多。');
  for(let i=0;i<count;i++){
    if(offset+46>b.length||u32(b,offset)!==0x02014b50)problem('XLSX 目录损坏。');
    const method=u16(b,offset+10),compressed=u32(b,offset+20),size=u32(b,offset+24),nameLen=u16(b,offset+28),extra=u16(b,offset+30),comment=u16(b,offset+32),local=u32(b,offset+42);
    const name=b.subarray(offset+46,offset+46+nameLen).toString('utf8');total+=size;
    if(size>16*1024*1024||total>32*1024*1024)problem('文件解压后过大。');
    if(name.endsWith('.xml')||name.endsWith('.rels')){
      if(local+30>b.length||u32(b,local)!==0x04034b50)problem('XLSX 文件记录损坏。');
      const start=local+30+u16(b,local+26)+u16(b,local+28);if(start+compressed>b.length)problem('XLSX 数据不完整。');
      const raw=b.subarray(start,start+compressed);
      if(![0,8].includes(method))problem('不支持此压缩格式。');
      const xml=(method===8?inflateRawSync(raw,{maxOutputLength:16*1024*1024}):raw).toString('utf8');
      if(/<!DOCTYPE|<!ENTITY/i.test(xml))problem('不支持包含外部实体的表格。');entries.set(name,xml);
    }
    offset+=46+nameLen+extra+comment;
  }
  const sst=[...(entries.get('xl/sharedStrings.xml')||'').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>texts(m[1]));
  const rels=new Map([...String(entries.get('xl/_rels/workbook.xml.rels')||'').matchAll(/<Relationship\b([^>]+)\/?\s*>/g)].map(m=>[attr(m[1],'Id'),attr(m[1],'Target')]));
  const sheets=[];
  for(const m of (entries.get('xl/workbook.xml')||'').matchAll(/<sheet\b([^>]+)\/?\s*>/g)){
    const target=rels.get(attr(m[1],'r:id'));if(!target)continue;
    const file=target.startsWith('/')?target.slice(1):posix.normalize('xl/'+target);
    const xml=entries.get(file);if(!xml)continue;const rows=[];
    for(const c of xml.matchAll(/<c\b([^>]*?)(?<!\/)>([\s\S]*?)<\/c>/g)){
      const ref=attr(c[1],'r').match(/^([A-Z]+)(\d+)$/);if(!ref)continue;
      const row=Number(ref[2])-1;let col=0;for(const letter of ref[1])col=col*26+letter.charCodeAt(0)-64;col--;
      if(row>10000||col>100)problem('课表范围过大。');
      const type=attr(c[1],'t'),value=decode(c[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]);
      rows[row]||=[];rows[row][col]=type==='s'?sst[Number(value)]||'':type==='inlineStr'?texts(c[2]):value;
    }
    sheets.push({name:attr(m[1],'name'),rows});
  }
  if(!sheets.length)problem('未找到可读取的工作表。');return sheets;
}
function parseWeeks(value){const result=[];for(const part of value.split(/[,，、]/)){const range=part.match(/^(\d+)\s*[-~～]\s*(\d+)$/);if(range){if(Number(range[2])-Number(range[1])>60)continue;for(let n=Number(range[1]);n<=Number(range[2]);n++)result.push(n);}else if(/^\d+$/.test(part.trim()))result.push(Number(part));}return [...new Set(result)].filter(n=>n>=1&&n<=60);}
function remarkDates(text,term){
  const result=[];
  for(const sentence of text.split(/[。；;\n]/)){
    const numbers=sentence.match(/第([\d、,，]+)次(?:课)?/);const lessons=numbers?numbers[1].split(/[、,，]/).map(Number):[];
    const matches=[...sentence.matchAll(/(?<![\d.\/年-])(?:(\d{4})[年.\/-])?(\d{1,2})[.月/\-](\d{1,2})(?:日)?(?!\d|节|人|周)/g)].filter(m=>m[1]||!m[0].includes('-'));
    for(const [index,m] of matches.entries()){
      const candidates=m[1]?[Number(m[1])]:String(term.academicYear||'').split('-').map(Number).filter(y=>y>=1900&&y<=2200);
      const dates=[...new Set(candidates.map(y=>`${y}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`).filter(validDate))];
      // A management boundary helps disambiguate the year; it never filters out an explicit lesson.
      const inside=term.startsOn&&term.endsOn?dates.filter(d=>d>=term.startsOn&&d<=term.endsOn):[];
      let date=m[1]&&dates.length===1?dates[0]:inside.length===1?inside[0]:null;
      if(!date&&inside.length===0&&term.startsOn&&term.endsOn){
        const distance=d=>Math.min(Math.abs(Date.parse(d)-Date.parse(term.startsOn)),Math.abs(Date.parse(d)-Date.parse(term.endsOn)))/86400000;
        const nearby=dates.filter(d=>distance(d)<=90);
        if(nearby.length===1)date=nearby[0];
      }
      result.push({date,lesson_number:lessons[index]||null,kind:/实践|调研/.test(sentence)?'practice':/调课|改为/.test(sentence)?'reschedule':lessons.length||/补课/.test(sentence)?'supplement':'lecture',raw:sentence});
    }
  }
  return result;
}
export function coursesFromFiles(files,term){
  if(!Array.isArray(files)||!files.length||files.length>5)problem('请选择 1—5 个需要合并到当前学期的 Excel 文件。');
  const courses=[];const warnings=[];
  let totalBytes=0;
  for(const file of files){
    if(typeof file.content!=='string')problem('文件内容缺失。');
    const b=Buffer.from(file.content,'base64');if(!b.length||b.length>2*1024*1024)problem('单个文件需小于 2 MB。');totalBytes+=b.length;if(totalBytes>6*1024*1024)problem('本次文件总大小不能超过 6 MB。');
    let sheets;
    try{sheets=b.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'))?xlsSheets(b):b.subarray(0,2).toString()==='PK'?xlsxSheets(b):problem('请上传真正的 XLS 或 XLSX 文件。');}
    catch(error){if(error.status)throw error;problem('文件无法完整读取，请在 Excel 中另存为标准 XLSX 后重试。');}
    let recognized=0;
    for(const sheet of sheets){
      const headerIndex=sheet.rows.findIndex(row=>row?.some(c=>String(c).trim()==='课程名称'));
      if(headerIndex<0)continue;
      const header=sheet.rows[headerIndex].map(c=>String(c||'').trim());
      const column=(row,names)=>{const at=header.findIndex(h=>names.includes(h));return at<0?'':String(row[at]??'').trim();};
      const heading=sheet.rows.slice(0,headerIndex).flat().filter(Boolean).join(' ');
      const yearPattern=/(\d{4})\s*[-—–]\s*(\d{4})/g;
      const checkYear=text=>{const years=[...text.matchAll(yearPattern)].map(m=>`${m[1]}-${m[2]}`);if(years.some(y=>y!==term.academicYear))problem(`${trim(file.name,100)} 不属于所选学年。`);return years[0]||null;};
      const headingYear=checkYear(heading);
      for(let index=headerIndex+1;index<sheet.rows.length;index++){
        const row=sheet.rows[index];if(!row)continue;
        const course_name=column(row,['课程名称']);if(!course_name)continue;recognized++;
        const semester=column(row,['学期','学季','学年学期']);
        const rawSchedule=column(row,['上课时间地点','上课时间']),room=column(row,['上课地点','教室']);
        const sourceYear=checkYear([column(row,['学年']),semester,rawSchedule].join(' '))||headingYear;
        const remarks=column(row,['备注']);const rules=[];
        const re=/([^\n]*?)\(第([\d,，、\-~～]+)周\)\s*\/\/\s*星期([一二三四五六日天])\s*\/\/\s*(\d+)\s*[-~]\s*(\d+)节\s*\/\/\s*([^/\n]+)/g;
        for(const m of rawSchedule.matchAll(re))rules.push({calendar_name:m[1].trim(),weeks:parseWeeks(m[2]),weekday:'一二三四五六日'.indexOf(m[3]==='天'?'日':m[3])+1,period_start:Number(m[4]),period_end:Number(m[5]),room:m[6].trim(),raw:m[0]});
        if(!rules.length){const m=rawSchedule.match(/星期([一二三四五六日天])\s*(?:第)?(\d+)\s*[-~]\s*(\d+)节/);if(m)rules.push({weeks:[],weekday:'一二三四五六日'.indexOf(m[1]==='天'?'日':m[1])+1,period_start:Number(m[2]),period_end:Number(m[3]),room:room||null,week_parity_raw:column(row,['单双周']),raw:rawSchedule});}
        courses.push({course_name,teacher:column(row,['主讲教师','任课老师','任课教师'])||null,
          course_code:column(row,['课程编号'])||null,teaching_class_code:rawSchedule.match(/班级编号\s*([\w-]+)/)?.[1]||column(row,['上课班编号','班级编号'])||null,
          academic_year:sourceYear,semester:term.name,extra_fields:semester?{'原表标注':[semester]}:{},room:room&&!/待|通知/.test(room)?room:null,
          weekly_rules:rules,special_dates:remarkDates(remarks,term),remarks_raw:remarks,schedule_raw:rawSchedule||room,
          credits:column(row,['学分'])||null,college:column(row,['开课学院']),required_or_elective:column(row,['必修/选修']),course_category:column(row,['课程性质']),
          source_rows:[{source:`${trim(file.name,100)} / ${sheet.name}`,row:index+1,raw:JSON.stringify(row)}],
          warnings:!rawSchedule||/待.*通知/.test(rawSchedule+room)?['来源未提供确定的上课时间或地点，请核对。']:[]});
      }
    }
    if(!recognized)problem(`${trim(file.name)} 未找到“课程名称”表头及课程记录。`);
  }
  if(courses.length>200)problem('每次最多导入 200 条课程。');
  return {courses,warnings};
}
