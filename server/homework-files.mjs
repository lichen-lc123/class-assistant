import {inflateRawSync} from 'node:zlib';
import {workbookAttachments} from './workbook-attachments.mjs';
import {removeLocalFilePaths,safeHomeworkLink} from '../shared/homework-links.mjs';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {problem,validDate,validTime} from './schedule.mjs';
import {homeworkCourseTime} from './homework-course-time.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const decode=s=>String(s||'').replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const attr=(s,key)=>decode(s.match(new RegExp('(?:^|\\s)'+key+'=["\x27]([^"\x27]*)["\x27]'))?.[1]);
const texts=s=>[...s.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g,'').matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(x=>decode(x[1])).join('');
const cell=s=>{const m=s.match(/^([A-Z]+)(\d+)$/);if(!m)problem('表格单元格位置无效。');let col=0;for(const l of m[1])col=col*26+l.charCodeAt(0)-64;return[Number(m[2])-1,col-1];};
const u16=(b,n)=>b.readUInt16LE(n),u32=(b,n)=>b.readUInt32LE(n);
export function unpackHomeworkWorkbook(b){
  if(b.subarray(0,2).toString()!=='PK')problem('请上传 XLSX 格式的作业表。旧 XLS 请另存为 XLSX。');
  let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65558);i--)if(u32(b,i)===0x06054b50){end=i;break;}
  if(end<0)problem('表格文件结构不完整。');
  const entries=new Map();let offset=u32(b,end+16),total=0;const count=u16(b,end+10);if(count>3000)problem('表格内容过多。');
  for(let i=0;i<count;i++){
    if(offset+46>b.length||u32(b,offset)!==0x02014b50)problem('表格目录损坏。');
    const flags=u16(b,offset+8),method=u16(b,offset+10),length=u32(b,offset+20),size=u32(b,offset+24),nl=u16(b,offset+28),el=u16(b,offset+30),cl=u16(b,offset+32),local=u32(b,offset+42),name=b.subarray(offset+46,offset+46+nl).toString('utf8');
    total+=size;if(size>16*1024*1024||total>48*1024*1024)problem('表格解压后过大。');
    if(flags&1)problem('加密表格请先解密。');
    if(/\.(?:xml|rels|vml|png|jpe?g|webp)$/i.test(name)||/^xl\/embeddings\/[^/]+$/i.test(name)){
      if(![0,8].includes(method)||local+30>b.length||u32(b,local)!==0x04034b50)problem('表格压缩记录无效。');
      const start=local+30+u16(b,local+26)+u16(b,local+28);if(start+length>b.length)problem('表格数据不完整。');
      const raw=method===8?inflateRawSync(b.subarray(start,start+length),{maxOutputLength:16*1024*1024}):b.subarray(start,start+length);
      if(/\.(xml|rels|vml)$/i.test(name)&&/<!DOCTYPE|<!ENTITY/i.test(raw.toString('utf8')))problem('不支持带外部实体的表格。');entries.set(posix.normalize(name),raw);
    }
    offset+=46+nl+el+cl;
  }
  const xml=name=>entries.get(name)?.toString('utf8')||'';
  const relationships=name=>new Map([...xml(name).matchAll(/<Relationship\b([^>]+)\/?\s*>/g)].filter(m=>attr(m[1],'TargetMode')!=='External').map(m=>[attr(m[1],'Id'),attr(m[1],'Target')]));
  const resolve=(base,target)=>target.startsWith('/')?target.slice(1):posix.normalize(posix.join(base,target));
  const strings=[...xml('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>texts(m[1]));
  const rels=relationships('xl/_rels/workbook.xml.rels'),sheets=[];
  for(const m of xml('xl/workbook.xml').matchAll(/<sheet\b([^>]+)\/?\s*>/g)){
    const target=rels.get(attr(m[1],'r:id'));if(!target)continue;const path=resolve('xl',target),source=xml(path),rows=[];
    for(const c of source.matchAll(/<c\b([^>]*?)(?<!\/)>([\s\S]*?)<\/c>/g)){
      const ref=attr(c[1],'r');if(!ref)continue;const [r,col]=cell(ref);if(r>10000||col>100)problem('作业表范围过大。');
      const value=decode(c[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]),type=attr(c[1],'t'),formula=decode(c[2].match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1]);
      rows[r]||=[];rows[r][col]=/DISPIMG/i.test(formula)?'='+formula:type==='s'?strings[Number(value)]||'':type==='inlineStr'?texts(c[2]):value;
      const linkFormula=formula.match(/(?:_xlfn\.)?HYPERLINK\(\s*"((?:[^"]|"")*)"(?:\s*[,;]\s*"((?:[^"]|"")*)")?/i);
      if(linkFormula){const url=safeHomeworkLink(linkFormula[1].replace(/""/g,'"'));rows[r][col]=[linkFormula[2]?.replace(/""/g,'"')||'',url||''].filter(Boolean).join('\n');}
      rows[r][col]=removeLocalFilePaths(rows[r][col]);
    }
    const original=rows.map(r=>r?[...r]:[]);
    let mergedCells=0;const merges=[];
    for(const merge of source.matchAll(/<mergeCell\b([^>]*)\/?\s*>/g)){
      const parts=attr(merge[1],'ref').split(':');if(parts.length!==2)continue;const [r1,c1]=cell(parts[0]),[r2,c2]=cell(parts[1]);
      if(r2>10000||c2>100||(r2-r1+1)*(c2-c1+1)>20000)problem('合并单元格范围过大。');
      merges.push({r1,c1,r2,c2});
      const value=rows[r1]?.[c1]||'';for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){if(++mergedCells>100000)problem('合并单元格过多。');rows[r]||=[];if(!rows[r][c])rows[r][c]=value;}
    }
    sheets.push({name:attr(m[1],'name'),rows,original,path,source,merges,images:new Map()});
  }
  const imageIds=new Map(),cellRels=relationships('xl/_rels/cellimages.xml.rels');
  const addImage=(name,rid,map,base)=>{const target=map.get(rid);if(target)imageIds.set(name,resolve(base,target));};
  for(const pic of xml('xl/cellimages.xml').matchAll(/<(?:\w+:)?pic\b[^>]*>([\s\S]*?)<\/(?:\w+:)?pic>/g)){
    const info=pic[1].match(/<(?:\w+:)?cNvPr\b([^>]*)/),blip=pic[1].match(/<(?:\w+:)?blip\b([^>]*)/);if(info&&blip)addImage(attr(info[1],'name'),attr(blip[1],'r:embed'),cellRels,'xl');
  }
  for(const path of entries.keys())if(/^xl\/drawings\/drawing\d+\.xml$/.test(path)){
    const map=relationships(posix.join(posix.dirname(path),'_rels',posix.basename(path)+'.rels'));
    for(const pic of xml(path).matchAll(/<(?:\w+:)?pic\b[^>]*>([\s\S]*?)<\/(?:\w+:)?pic>/g)){const info=pic[1].match(/<(?:\w+:)?cNvPr\b([^>]*)/),blip=pic[1].match(/<(?:\w+:)?blip\b([^>]*)/);if(info&&blip&&!imageIds.has(attr(info[1],'name')))addImage(attr(info[1],'name'),attr(blip[1],'r:embed'),map,posix.dirname(path));}
  }
  const imageIssues=[];let anchoredImages=0;
  for(const sheet of sheets){
    const sheetRels=relationships(posix.join(posix.dirname(sheet.path),'_rels',posix.basename(sheet.path)+'.rels'));
    for(const drawing of sheet.source.matchAll(/<(?:\w+:)?drawing\b([^>]*)\/?\s*>/g)){
      const target=sheetRels.get(attr(drawing[1],'r:id'));if(!target){imageIssues.push(`${sheet.name} 有无法读取的图片引用，请核对。`);continue;}
      const path=resolve(posix.dirname(sheet.path),target),source=xml(path),rels=relationships(posix.join(posix.dirname(path),'_rels',posix.basename(path)+'.rels'));
      for(const anchor of source.matchAll(/<(?:\w+:)?(oneCellAnchor|twoCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g)){
        const pics=[...anchor[2].matchAll(/<(?:\w+:)?pic\b[^>]*>([\s\S]*?)<\/(?:\w+:)?pic>/g)];if(!pics.length)continue;
        const from=anchor[2].match(/<(?:\w+:)?from\b[^>]*>([\s\S]*?)<\/(?:\w+:)?from>/)?.[1]||'';
        let row=Number(from.match(/<(?:\w+:)?row\b[^>]*>(\d+)<\/(?:\w+:)?row>/)?.[1]??NaN),col=Number(from.match(/<(?:\w+:)?col\b[^>]*>(\d+)<\/(?:\w+:)?col>/)?.[1]??NaN);
        if(!Number.isInteger(row)||!Number.isInteger(col)){imageIssues.push(`${sheet.name} 有未绑定单元格的浮动图片，未自动归入作业，请核对。`);continue;}
        if(row>10000||col>100)problem('作业图片位置超出可读取范围。');
        const merged=sheet.merges.find(m=>row>=m.r1&&row<=m.r2&&col>=m.c1&&col<=m.c2);if(merged){row=merged.r1;col=merged.c1;}
        sheet.rows[row]||=[];
        for(const pic of pics){
          if(++anchoredImages>500)problem('浮动图片过多，每次最多读取500张。');
          const blip=pic[1].match(/<(?:\w+:)?blip\b([^>]*)/),rid=blip?attr(blip[1],'r:embed'):null,imageTarget=rid?rels.get(rid):null;
          const id=`__drawing_${anchoredImages}`;imageIds.set(id,imageTarget?resolve(posix.dirname(path),imageTarget):'');
          const key=row+'|'+col;sheet.images.set(key,[...(sheet.images.get(key)||[]),id]);
        }
      }
    }
  }
  const embedded=workbookAttachments({sheets,entries,xml,attr,resolve,cell,relationships});
  return{sheets,entries,imageIds,imageIssues:[...imageIssues,...embedded.warnings],embeddedFiles:embedded.files,date1904:/<workbookPr\b[^>]*date1904=["'](?:1|true)["']/.test(xml('xl/workbook.xml'))};
}
export function imageMime(bytes){if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'image/jpeg';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return'image/webp';return null;}
export const normalizeCourseName=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').replace(/\((?:秋冬|春夏|秋|冬|春|夏)(?:季|学期|学季)?[^)]*\)$/,'');
const clean=s=>String(s??'').trim();
export const noHomework=s=>/^([-\/／—无]+|无作业)$/.test(clean(s).normalize('NFKC').replace(/[\s。.!！,，;；:：]/g,''));
const meaningful=s=>Boolean(clean(s)&&!noHomework(s));
export function parseHomeworkDeadline(value,term,date1904=false){
  const raw=clean(value),warnings=[];if(!meaningful(raw))return{due_date:null,due_time:null,deadline_raw:raw,warnings};
  if(/^\d+(?:\.\d+)?$/.test(raw)&&Number(raw)>30000&&Number(raw)<80000){const n=Number(raw),iso=new Date(Date.parse(date1904?'1904-01-01T00:00:00Z':'1899-12-30T00:00:00Z')+n*86400000).toISOString();return{due_date:iso.slice(0,10),due_time:n%1?iso.slice(11,16):null,deadline_raw:raw,warnings:n%1?[]:['原表仅给出截止日期，未注明具体时刻。']};}
  const text=raw.replace(/：/g,':'),full=text.match(/(20\d{2})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})/),short=text.match(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  let due=null;
  if(full)due=`${full[1]}-${full[2].padStart(2,'0')}-${full[3].padStart(2,'0')}`;
  else if(short){const years=[...new Set([term.startsOn?.slice(0,4),term.endsOn?.slice(0,4)].filter(Boolean))],candidates=years.map(y=>`${y}-${short[1].padStart(2,'0')}-${short[2].padStart(2,'0')}`).filter(d=>validDate(d)&&d>=term.startsOn&&d<=term.endsOn);if(candidates.length===1)due=candidates[0];}
  if(due&&!validDate(due))problem('截止日期不存在，请核对原表或修改日期。');
  const clock=text.match(/(?<!\d)(\d{1,2}):([0-5]\d)(?!\d)/),time=clock?clock[1].padStart(2,'0')+':'+clock[2]:null;
  if(time&&!validTime(time))problem('截止时间无效，请核对原表。');
  if(!due)warnings.push('截止说明未能确定唯一日期，已保留原文，请核对。');else if(!time)warnings.push('原表未注明具体截止时刻，按日期展示。');
  if(/最晚|延期|延迟|扣分/.test(raw))warnings.push('截止说明含延期或扣分规则，保留原文；请核对主要截止日期。');
  return{due_date:due,due_time:due?time:null,deadline_raw:raw,warnings};
}

export function homeworkFromFile(file,term){
  if(!file||typeof file.content!=='string'||!/\.xlsx$/i.test(file.name||''))problem('请选择 XLSX 作业表。');
  const bytes=Buffer.from(file.content,'base64');if(!bytes.length||bytes.length>20*1024*1024)problem('作业表不能超过 20 MB。');
  let book;try{book=unpackHomeworkWorkbook(bytes);}catch(e){if(e.status)throw e;problem('表格无法读取，请另存为标准 XLSX 后重试。');}
  const records=new Map(),policies=new Map(),assets=new Map(),warnings=[...book.imageIssues],recognized=[],ignored=[],usedImages=new Set(),usedFiles=new Set();let assetBytes=0;
  const part=(value,field,caption)=>{
    const attachments=[];let text=removeLocalFilePaths(clean(value));
    text=text.replace(/=?EMBEDFILE\("(embedded_\d+)"\)/g,(_,name)=>{
      usedFiles.add(name);const file=book.embeddedFiles.get(name);
      if(!file)return '【原表附件待补充】';
      const {bytes:blob,filename}=file,mime=imageMime(blob)||'application/octet-stream',id=hash(blob);
      if(blob.length>10*1024*1024||mime.startsWith('image/')&&blob.length>5*1024*1024)problem('单个附件不能超过10 MB，图片不能超过5 MB。');
      if(!assets.has(id)){assetBytes+=blob.length;if(assetBytes>20*1024*1024)problem('表格图片与附件合计不能超过20 MB。');assets.set(id,{id,mime,content:blob.toString('base64')});}
      attachments.push({assetId:id,field:file.field||field,caption,filename,mime,size:blob.length});return '';
    });
    text=text.replace(/=?\b(?:_xlfn\.)?DISPIMG\(\s*["']([^"']+)["'][^)]*\)/gi,(_,name)=>{
      usedImages.add(name);
      const path=book.imageIds.get(name),blob=path?book.entries.get(path):null,mime=blob?imageMime(blob):null;
      if(!blob||!mime){warnings.push(`${caption} 有无法提取的图片，请核对原表。`);return'【原表图片待补充】';}
      if(blob.length>5*1024*1024)problem('单张作业图片不能超过 5 MB。');const id=hash(blob);
      if(!assets.has(id)){assetBytes+=blob.length;if(assetBytes>20*1024*1024)problem('作业图片与附件合计不能超过 20 MB。');assets.set(id,{id,mime,content:blob.toString('base64')});}
      attachments.push({assetId:id,field,caption,mime,size:blob.length});return'';
    });
    return{text:text.trim(),attachments};
  };
  const append=(item,key,value,source=item.source)=>{const p=part(value,key,source);if(p.text&&!item[key].split('\n\n').includes(p.text))item[key]+=(item[key]?'\n\n':'')+p.text;for(const a of p.attachments)if(!item.attachments.some(x=>x.assetId===a.assetId&&x.field===a.field))item.attachments.push(a);};
  const create=(kind,course,teacher,title,source)=>({kind,course_name:course,teacher,title,content:'',submission:'',assessment_rules:'',team_requirement:'',notes:'',due_date:null,due_time:null,deadline_raw:'',attachments:[],warnings:[],source,source_rows:[],credits:''});
  const review=(item,reason)=>{item.review_required=true;item.review_reasons=[...new Set([...(item.review_reasons||[]),reason])];};
  const deadline=(item,value,date1904=false)=>{try{Object.assign(item,parseHomeworkDeadline(value,term,date1904));if(meaningful(item.deadline_raw)&&!item.due_date&&!/^(?:待通知|另行通知|待定|未定|暂无|未公布|待公布|暂无截止时间|截止时间待通知)$/.test(clean(value)))review(item,'截止说明无法确定具体日期，请核对；如暂未通知可清空截止说明。');}catch(error){if(error.status!==400)throw error;Object.assign(item,{due_date:null,due_time:null,deadline_raw:clean(value)});review(item,'原表截止日期或时间无效，请管理员核对。');}};
  const getPolicy=(course,teacher,source)=>{const key=normalizeCourseName(course)+'|'+teacher;if(!policies.has(key))policies.set(key,create('reference',course,teacher,'课程考核与说明',source));return policies.get(key);};
  const hasEnglishDetails=book.sheets.some(s=>s.rows.some(r=>r?.includes('课次')&&r?.includes('作业内容')));
  for(const sheet of book.sheets){
    const headerIndex=sheet.rows.findIndex(r=>r?.includes('课程名称')&&r.some(v=>/作业.*内容|作业内容/.test(v)));
    const englishIndex=sheet.rows.findIndex(r=>r?.includes('课次')&&r?.includes('作业内容'));
    if(headerIndex<0&&englishIndex<0){
      ignored.push(sheet.name);
      const values=sheet.rows.flatMap((row,i)=>row?.some(meaningful)?['第'+(i+1)+'行：'+row.map(removeLocalFilePaths).join(' | ')]:[]);
      const original=values.join('\n');
      if(original&&!/校历|作息/.test(sheet.name))for(let offset=0;offset<original.length;offset+=18000){const part=offset/18000+1,item=create('assignment','','','待核对工作表：'+sheet.name+(original.length>18000?'（'+part+'）':''),file.name+' / '+sheet.name);item.content=original.slice(offset,offset+18000);item.source_rows=[{sheet:sheet.name,raw:{未识别表格:item.content}}];review(item,'工作表结构无法自动识别，原文已保留，请核对课程、老师和作业内容。');records.set('unparsed-sheet:'+sheet.name+':'+part,item);}
      continue;
    }
    recognized.push(sheet.name);const isEnglish=headerIndex<0,h=isEnglish?englishIndex:headerIndex,headers=sheet.rows[h];
    const index=(...names)=>headers.findIndex(v=>names.includes(clean(v)));
    const ci=index('课程名称'),ti=index('任课老师','任课教师'),wi=headers.findIndex(v=>/作业.*内容|作业内容/.test(v)),di=index('截止日期','截止时间'),pi=index('提交平台'),ri=index('课程考核规则'),gi=index('是否需要组队'),ni=index('备注'),li=index('课次'),credit=index('学分'),sequence=index('序号');
    const englishCourse=clean(sheet.rows.slice(0,h).flat().find(v=>String(v).includes('英语应用能力'))||'研究生英语应用能力提升').replace(/[（(].*$/,'');
    const auxSeen=new Set();let auxTitle=clean(headers[6])||'补充考核说明';
    for(let row=h+1;row<sheet.rows.length;row++){
      const values=sheet.rows[row];if(!values)continue;const course=isEnglish?englishCourse:clean(values[ci]),teacher=clean(values[ti]);
      const fieldValue=col=>[clean(values[col]),...(sheet.images.get(row+'|'+col)||[]).map(id=>`=DISPIMG("${id}",1)`),...(sheet.files.get(row+'|'+col)||[]).map(id=>`=EMBEDFILE("${id}")`)].filter(Boolean).join('\n');
      if(!course||!teacher){
        if(!values.some(meaningful)&&![...sheet.images.keys(),...sheet.files.keys()].some(k=>k.startsWith(row+'|')))continue;
        if(noHomework(values[wi])&&![values[ri],values[pi],values[gi],values[ni]].some(meaningful))continue;
        const source=`${file.name} / ${sheet.name} / 第${row+1}行`,raw=Object.fromEntries(headers.map((name,col)=>[clean(name)||'附加列'+col,clean(values[col])]).filter(([,value])=>value));
        const item=create(noHomework(values[wi])?'reference':'assignment',course,teacher,`待核对记录：${sheet.name} 第${row+1}行`,source);item.source_rows.push({sheet:sheet.name,row:row+1,raw});
        append(item,item.kind==='reference'?'notes':'content',fieldValue(wi)||Object.entries(raw).map(([k,v])=>k+'：'+v).join('\n')||'原表图片或附件，请核对');
        for(const [field,col]of [['submission',pi],['assessment_rules',ri],['notes',ni]])if(col>=0)append(item,field,fieldValue(col));
        review(item,'课程名称或任课老师缺失，原始内容已保留。');records.set('unparsed-row:'+sheet.name+':'+row,item);continue;
      }
      const source=`${file.name} / ${sheet.name} / 第${row+1}行`,policy=getPolicy(course,teacher,source);
      const raw=Object.fromEntries(headers.map((v,c)=>[`${clean(v)||'附加列'}（第${c+1}列）`,clean(values[c])]).filter(([,v])=>v));policy.source_rows.push({sheet:sheet.name,row:row+1,raw});
      for(const [key,col]of [['submission',pi],['assessment_rules',ri],['team_requirement',gi],['notes',ni]])if(col>=0&&meaningful(fieldValue(col)))append(policy,key,fieldValue(col),source);
      policy.credits=policy.credits||clean(values[credit]);policy.sequence=policy.sequence||clean(values[sequence]);
      const attachmentCols=headers.flatMap((name,col)=>/附件|参考资料|资料文件|下载链接/.test(clean(name))?[col]:[]);
      const known=new Set([ci,ti,wi,di,pi,ri,gi,ni,li,credit,sequence,...attachmentCols,...(isEnglish?[6,7]:[])]);
      const unknown=headers.flatMap((name,col)=>!known.has(col)&&!/^(?:上课时间|授课时间|课程时间|上课日期|授课日期|课程编号|上课班)/.test(clean(name))&&meaningful(values[col])?[(clean(name)||'未命名列')+'：'+clean(values[col])]:[]);
      if(unknown.length){append(policy,'notes','待核对原表字段：\n'+unknown.join('\n'));review(policy,'存在系统未识别的原表字段，内容已保留，请核对。');}
      let content=noHomework(values[wi])?'':[fieldValue(wi),...attachmentCols.filter(col=>col!==wi).map(fieldValue)].filter(Boolean).join('\n');const title=isEnglish?clean(values[li]).replace('次课','次作业'):clean(headers[wi]).replace('内容','')||'课程作业';
      if(hasEnglishDetails&&!isEnglish&&/英语/.test(course)&&/见表格.*英语/.test(content)){append(policy,'notes','作业详情已从“英语秋季课程”表按课次和老师导入。');content='';}
      if(/^已结束$/.test(content)){append(policy,'notes',`${title}：原表标记已结束。`);content='';}
      if(meaningful(content)){
        const key=normalizeCourseName(course)+'|'+teacher+'|'+title;if(!records.has(key))records.set(key,create('assignment',course,teacher,title,source));const item=records.get(key);append(item,'content',content,source);item.source_rows.push({sheet:sheet.name,row:row+1,raw});
        for(const [field,col]of [['submission',pi],['notes',ni]])if(col>=0&&meaningful(fieldValue(col)))append(item,field,fieldValue(col));
        item.team_requirement=clean(values[gi]);item.credits=clean(values[credit]);item.sequence=clean(values[sequence]);
        if(unknown.length)review(item,'存在系统未识别的原表字段，请核对同课程待确认说明。');
        if(di>=0){if(!item.deadline_raw)deadline(item,values[di],book.date1904);else if(meaningful(values[di])&&clean(values[di])!==item.deadline_raw){review(item,'同一作业出现不同截止说明，请管理员核对。');append(item,'notes','原表另有截止说明：'+clean(values[di]));}}
      }
      if(isEnglish){
        for(let col=6;col<Math.min(8,values.length);col++){
          const original=clean(sheet.original[row]?.[col]);if(!original||auxSeen.has(col+'|'+original))continue;auxSeen.add(col+'|'+original);
          if(/^期末作业/.test(original)){auxTitle=original;continue;}
          const target=original.match(/^([^：:\n]{1,15})班级\s*[:：]/)?.[1]||teacher;
          const midterm=/中期/.test(auxTitle)&&/提交|截止/.test(original),extraTitle=midterm?'中期作业（演讲视频）':auxTitle;
          if(midterm){const key=normalizeCourseName(course)+'|'+target+'|'+extraTitle;if(!records.has(key))records.set(key,create('assignment',course,target,extraTitle,source));const item=records.get(key);append(item,'content',original);const due=original.match(/(?:作业)?提交截止时间[^\n。]*[。]?/);if(due&&!item.deadline_raw)deadline(item,due[0]);item.source_rows.push({sheet:sheet.name,row:row+1,raw:{[headers[col]||'附加说明']:original}});}
          else append(getPolicy(course,target,source),'assessment_rules',`${extraTitle}\n${original}`,source);
        }
      }
    }
  }
  const result=[...policies.values()].filter(r=>r.submission||r.assessment_rules||r.team_requirement||r.notes||r.attachments.length).concat([...records.values()]);if(!recognized.length&&!result.length)problem('表格没有可保留的内容，请核对原文件。');if(result.length>500)problem('一次最多导入 500 条作业及考核记录。');
  for(const item of result){item.course_time=homeworkCourseTime(item);item.warnings=[...new Set(item.warnings)];if(item.attachments.length)item.warnings.push('已保留原表图片或附件，请在预览中核对内容及适用课程。');if(/【原表(?:图片|附件)待补充】/.test([item.content,item.notes,item.assessment_rules,item.submission].join('\n')))review(item,'原表存在未成功提取的图片或附件，请补充核对。');}
  const unmatched=book.sheets.flatMap(sheet=>[...sheet.images.values()].flat()).filter(id=>!usedImages.has(id));
  if(unmatched.length)warnings.push(`有 ${unmatched.length} 张浮动图片未归入有效作业字段（可能是非作业列、缺少课程老师或内容标为“无”），请对照原表核对。`);
  const unmatchedFiles=book.sheets.flatMap(sheet=>[...sheet.files.values()].flat()).filter(id=>!usedFiles.has(id));
  if(unmatchedFiles.length)warnings.push(`有 ${unmatchedFiles.length} 个内嵌附件未归入有效作业字段，请对照原表补充，内容为“无”的行不会生成作业。`);
  if(ignored.length)warnings.push(`未作为作业表处理的工作表：${ignored.join('、')}。`);
  return{records:result,assets:[...assets.values()],warnings:[...new Set(warnings)],sheets:recognized,ignoredSheets:ignored};
}
