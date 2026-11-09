import {attachmentFieldNames} from './types';
import {useRef,useState} from 'react';
import {ImagePlus,Paperclip,Trash2,FileText} from 'lucide-react';
import {errorMessage} from '../timetable/types';
import type {HomeworkAsset,HomeworkAttachment} from './types';

export const fileSize=(size:number)=>size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KB`:`${(size/1024/1024).toFixed(1)} MB`;
function imageType(bytes:Uint8Array){
  if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'image/jpeg';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return'image/webp';
  return null;
}
export function HomeworkAttachmentsEditor({attachments,assets,disabled,onChange,onProcessing}:{attachments:HomeworkAttachment[];assets:HomeworkAsset[];disabled:boolean;onChange:(refs:HomeworkAttachment[],files:HomeworkAsset[])=>void;onProcessing:(busy:boolean)=>void}){
  const [error,setError]=useState(''),[processing,setProcessing]=useState(false);
  const lock=useRef(false),initialAssets=useRef(new Set(assets.map(a=>a.id)));
  async function add(files:File[],imageOnly:boolean){
    if(disabled||lock.current||!files.length)return;
    lock.current=true;setProcessing(true);onProcessing(true);setError('');
    try{
      if(attachments.length+files.length>20)throw new Error('每项作业最多添加20个图片或附件，请先移除不需要的文件。');
      const refs=[...attachments],uploaded=[...assets];
      let total=attachments.reduce((sum,a)=>sum+(a.size||Math.floor((assets.find(x=>x.id===a.assetId)?.content.length||0)*3/4)),0);
      for(const file of files){
        if(!file.size)throw new Error(`“${file.name}”是空文件，请重新选择。`);
        if(file.size>(imageOnly?5:10)*1024*1024)throw new Error(`“${file.name}”超过${imageOnly?'图片5':'附件10'} MB限制。`);
        total+=file.size;if(total>20*1024*1024)throw new Error('本项作业的图片与附件合计不能超过20 MB。');
        const bytes=new Uint8Array(await file.arrayBuffer()),image=imageType(bytes),mime=image||'application/octet-stream';
        if(imageOnly&&!image)throw new Error('图片仅支持PNG、JPG和WebP，请重新选择。');
        if(image&&file.size>5*1024*1024)throw new Error(`“${file.name}”超过图片5 MB限制。`);
        if(!crypto.subtle)throw new Error('请通过HTTPS或本机地址访问网站后上传文件。');
        const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
        const field=imageOnly?'content':'attachment';
        if(refs.some(a=>a.assetId===id&&a.field===field))continue;
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        if(!uploaded.some(a=>a.id===id))uploaded.push({id,mime,content:btoa(binary)});
        refs.push({assetId:id,field,caption:'',filename:file.name,mime,size:file.size});
      }
      onChange(refs,uploaded);
    }catch(e){setError(errorMessage(e));}
    finally{lock.current=false;setProcessing(false);onProcessing(false);}
  }
  function remove(index:number){
    const refs=attachments.filter((_,i)=>i!==index),ids=new Set(refs.map(a=>a.assetId));
    onChange(refs,assets.filter(a=>initialAssets.current.has(a.id)||ids.has(a.id)));setError('');
  }
  return <section className="homework-upload-editor" aria-label="作业图片与附件"><h3>图片与附件</h3><div className="homework-upload-actions"><label className="secondary-button"><ImagePlus size={17}/>添加图片<input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={disabled||processing} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void add(files,true);}}/></label><label className="secondary-button"><Paperclip size={17}/>添加附件<input type="file" multiple disabled={disabled||processing} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void add(files,false);}}/></label></div><p className="muted-note">图片支持PNG、JPG、WebP，单张最多5 MB；附件单个最多10 MB，每项最多20个文件，合计最多20 MB。保存作业后上传。</p>
    {processing&&<p role="status" className="muted-note">正在读取文件，请稍候…</p>}{error&&<p role="alert" className="feedback">{error}</p>}
    {!!attachments.length&&<div className="homework-upload-list">{attachments.map((a,index)=>{const asset=assets.find(x=>x.id===a.assetId),mime=asset?.mime||a.mime,url=asset?`data:${mime};base64,${asset.content}`:a.url,image=mime?.startsWith('image/');return <div className="homework-upload-item" key={a.assetId+':'+a.field}>{image&&url?<img src={url} alt={a.filename||a.caption||'作业图片预览'}/>:<FileText size={25}/>}<div><strong>{a.filename||a.caption||(image?'作业图片':'作业附件')}</strong><small>{a.size?fileSize(a.size):image?'图片':'附件'}{' · '+(attachmentFieldNames[a.field]||'附件')}</small></div><button type="button" className="icon-button danger-text" aria-label={'移除'+(a.filename||a.caption||'文件')} disabled={disabled||processing} onClick={()=>remove(index)}><Trash2 size={17}/></button></div>;})}</div>}
  </section>;
}
