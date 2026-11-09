import {posix} from 'node:path';
import {unpackHomeworkWorkbook,imageMime} from './homework-files.mjs';

const decode=text=>text.replace(/&#x([a-f0-9]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
function xmlTree(xml){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('不支持带外部实体的文档');
 const root={name:'root',attrs:{},children:[]},stack=[root];let count=0;
 for(const token of xml.matchAll(/<[^>]+>|[^<]+/g)){
  const value=token[0];if(value.startsWith('<?')||value.startsWith('<!'))continue;
  if(value.startsWith('</')){if(stack.length>1)stack.pop();continue;}
  if(value.startsWith('<')){
   if(++count>200000||stack.length>120)throw new Error('文档结构过于复杂，请下载查看');
   const name=value.match(/^<([^\s/>]+)/)?.[1];if(!name)continue;
   const attrs=Object.fromEntries([...value.matchAll(/([^\s=]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1],decode(m[2])]));
   const node={name,attrs,children:[]};stack.at(-1).children.push(node);if(!value.endsWith('/>'))stack.push(node);
  }else stack.at(-1).children.push(decode(value));
 }
 return root;
}
const elements=node=>node.children?.filter(c=>typeof c!=='string')||[];
const find=(node,name)=>node.name===name?node:elements(node).map(c=>find(c,name)).find(Boolean);
const all=(node,name)=>[...(node.name===name?[node]:[]),...elements(node).flatMap(c=>all(c,name))];
const textOf=node=>node.children?.map(c=>typeof c==='string'?c:textOf(c)).join('')||'';

// Return text and raster images only. Never execute Office HTML, macros, OLE,
// hyperlinks or external relationship targets; keep the original downloadable.
export function officePreview(bytes,filename){
 if(!/\.(docx|pptx)$/i.test(filename))return{format:'unsupported',message:'此格式暂不支持站内预览，可直接下载原文件。',pages:[]};
 const {entries}=unpackHomeworkWorkbook(Buffer.from(bytes));let imageBytes=0,blocksCount=0;
 const source=path=>entries.get(path)?.toString('utf8')||'';
 const relationships=path=>{
  const dir=posix.dirname(path),rels=source(posix.join(dir,'_rels',posix.basename(path)+'.rels'));
  if(/<!DOCTYPE|<!ENTITY/i.test(rels))throw new Error('不支持的文档关系');
  return new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].flatMap(m=>{
   const attr=Object.fromEntries([...m[1].matchAll(/([\w:]+)=["']([^"']*)["']/g)].map(a=>[a[1],decode(a[2])]));
   if(attr.TargetMode==='External'||!attr.Id||!attr.Target)return[];
   const target=posix.normalize(posix.join(dir,attr.Target));return target.startsWith('word/media/')||target.startsWith('ppt/media/')?[[attr.Id,target]]:[];
  }));
 };
 const image=(rid,rels)=>{const path=rels.get(rid),blob=path&&entries.get(path),mime=blob&&imageMime(blob);if(!mime)return null;imageBytes+=blob.length;if(imageBytes>16*1024*1024)throw new Error('文档图片较多，请下载原文件查看');return{type:'image',src:`data:${mime};base64,${blob.toString('base64')}`,alt:'文档图片'};};
 const paragraph=(node,rels)=>{
  let text='';const images=[];
  const visit=n=>{if(typeof n==='string')return;if(['w:t','a:t'].includes(n.name))text+=textOf(n);else if(['w:br','a:br'].includes(n.name))text+='\n';else if(n.name==='w:tab')text+='  ';else if(n.name==='a:blip'){const item=image(n.attrs['r:embed'],rels);if(item)images.push(item);}else for(const c of n.children||[])visit(c);};
  visit(node);const style=find(node,'w:pStyle')?.attrs['w:val']||'';
  return[...(text.trim()?[{type:/heading|title/i.test(style)?'heading':'text',text}]:[]),...images];
 };
 const limit=blocks=>{blocksCount+=blocks.length;if(blocksCount>5000)throw new Error('文档内容较长，请下载原文件查看');return blocks;};
 if(/\.docx$/i.test(filename)){
  if(!entries.has('word/document.xml'))throw new Error('Word 文件结构无法识别');
  const body=find(xmlTree(source('word/document.xml')),'w:body'),rels=relationships('word/document.xml'),blocks=[];
  if(!body)throw new Error('文档正文为空');
  for(const node of elements(body)){
   if(node.name==='w:p')blocks.push(...limit(paragraph(node,rels)));
   if(node.name==='w:tbl'){
    const rows=elements(node).filter(n=>n.name==='w:tr').map(row=>elements(row).filter(n=>n.name==='w:tc').map(cell=>all(cell,'w:p').flatMap(p=>paragraph(p,rels))));
    if(rows.length>500||rows.some(row=>row.length>100))throw new Error('文档表格过大，请下载查看');
    blocks.push(...limit([{type:'table',rows}]));
   }
  }
  const pages=[];for(let i=0;i<blocks.length;i+=18)pages.push({label:'内容 '+(pages.length+1),blocks:blocks.slice(i,i+18)});
  return{format:'document',message:'内容预览保留文字、表格和图片，完整排版以原文件为准。',pages};
 }
 const slides=[...entries.keys()].filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));
 if(!slides.length||slides.length>300)throw new Error('PPT 页数或结构无法预览');
 const presentation=source('ppt/presentation.xml'),slideRels=source('ppt/_rels/presentation.xml.rels');
 const order=[...presentation.matchAll(/<p:sldId\b[^>]*r:id=["']([^"']+)["']/g)].map(m=>m[1]);
 const map=new Map([...slideRels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map(m=>{const attrs=Object.fromEntries([...m[1].matchAll(/([\w:]+)=["']([^"']*)["']/g)].map(a=>[a[1],a[2]]));return[attrs.Id,posix.normalize(posix.join('ppt',attrs.Target||''))];}));
 const ordered=order.map(id=>map.get(id)).filter(path=>slides.includes(path));
 return{format:'presentation',message:'内容预览保留文字和图片，动画与完整排版以原文件为准。',pages:(ordered.length===slides.length?ordered:slides).map((path,i)=>{
  const root=xmlTree(source(path)),rels=relationships(path),shapeTree=find(root,'p:spTree'),blocks=[];
  for(const shape of elements(shapeTree||root)){
   const texts=all(shape,'a:p');for(const p of texts)blocks.push(...paragraph(p,rels));
   // Picture shapes have no text paragraph.
   if(!texts.length)for(const blip of all(shape,'a:blip')){const item=image(blip.attrs['r:embed'],rels);if(item)blocks.push(item);}
  }
  return{label:'第 '+(i+1)+' 页',blocks:limit(blocks)};
 })};
}
