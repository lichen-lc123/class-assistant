import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Download,Share2} from 'lucide-react';
import {Modal} from '../components/Modal';
import type {HomeworkAttachment} from './types';
import type {PDFDocumentProxy} from 'pdfjs-dist/types/src/display/api';

type Block={type:string;text?:string;src?:string;alt?:string;rows?:Block[][][]};
type OfficePreview={format:string;message:string;pages:{label:string;blocks:Block[]}[]};
const pdfAssets='/pdfjs/6.5.438/';
const mimeTypes:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',ppt:'application/vnd.ms-powerpoint',zip:'application/zip'};
const fileMime=(name:string)=>mimeTypes[name.split('.').pop()?.toLowerCase()||'']||'application/octet-stream';
function Blocks({blocks}:{blocks:Block[]}){return <>{blocks.map((block,i)=>block.type==='image'?<img key={i} src={block.src} alt={block.alt||'文档图片'}/>:block.type==='table'?<div key={i} className="attachment-preview-table"><table><tbody>{block.rows?.map((row,r)=><tr key={r}>{row.map((cell,c)=><td key={c}><Blocks blocks={cell}/></td>)}</tr>)}</tbody></table></div>:block.type==='heading'?<h3 key={i}>{block.text}</h3>:<p key={i}>{block.text}</p>)}</>;}
export default function AttachmentViewer({attachment,url,onClose}:{attachment:HomeworkAttachment;url:string;onClose:()=>void}){
 const name=attachment.filename||attachment.caption||'附件',isPdf=/\.pdf$/i.test(name),isOffice=/\.(docx|pptx)$/i.test(name);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[file,setFile]=useState<File|null>(null),[blobUrl,setBlobUrl]=useState('');
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[office,setOffice]=useState<OfficePreview|null>(null),[page,setPage]=useState(1),[rendering,setRendering]=useState(false);
 const canvas=useRef<HTMLCanvasElement>(null),container=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const abort=new AbortController();let active=true,objectUrl='',task:ReturnType<typeof import('pdfjs-dist')['getDocument']>|null=null;
  async function load(){try{
   const response=await fetch(url,{credentials:'same-origin',signal:abort.signal});
   if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('session-expired'));throw new Error(response.status===403?'你没有权限查看此附件。':'附件读取失败，请刷新后重试。');}
   const bytes=await response.arrayBuffer();if(!active)return;
   const data=new File([bytes],name,{type:fileMime(name)});objectUrl=URL.createObjectURL(data);setFile(data);setBlobUrl(objectUrl);
   if(isPdf){
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const worker=await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');if(!active)return;
    pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
    task=pdfjs.getDocument({data:new Uint8Array(bytes),cMapUrl:pdfAssets+'cmaps/',cMapPacked:true,standardFontDataUrl:pdfAssets+'standard_fonts/',wasmUrl:pdfAssets+'wasm/',enableXfa:false});
    const document=await task.promise;if(!active){await task.destroy();return;}setPdf(document);
   }else if(isOffice){
    if(url.startsWith('data:'))throw new Error('保存作业后即可查看文档内容，当前可下载核对。');
    const preview=await fetch(url+(url.includes('?')?'&':'?')+'preview=1',{credentials:'same-origin',signal:abort.signal});
    if(!preview.ok)throw new Error('暂时无法读取文档预览。');const body:OfficePreview=await preview.json();if(active)setOffice(body);
   }
  }catch(e){if(active)setError(e instanceof Error?e.message:'暂时无法预览，可下载原文件。');}finally{if(active)setLoading(false);}}
  void load();return()=>{active=false;abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);if(task)void task.destroy();};
 },[url,name,isPdf,isOffice]);
 useEffect(()=>{
  if(!pdf)return;let active=true,renderTask:{cancel:()=>void;promise:Promise<unknown>}|null=null;
  async function render(){setRendering(true);try{const sheet=await pdf!.getPage(page);if(!active||!canvas.current)return;const width=Math.max(220,(container.current?.clientWidth||360)-16),viewport=sheet.getViewport({scale:1}),scale=Math.min(2,window.devicePixelRatio||1),view=sheet.getViewport({scale:width/viewport.width});const element=canvas.current;element.width=Math.floor(view.width*scale);element.height=Math.floor(view.height*scale);element.style.width='100%';element.style.height='auto';renderTask=sheet.render({canvas:element,viewport:view,transform:scale===1?undefined:[scale,0,0,scale,0,0]});await renderTask.promise;}catch(e){if(active&&!(e instanceof Error&&e.name==='RenderingCancelledException'))setError('这一页暂时无法显示，可下载原文件查看。');}finally{if(active)setRendering(false);}}
  void render();return()=>{active=false;renderTask?.cancel();};
 },[pdf,page]);
 const count=pdf?.numPages||office?.pages.length||1;
 let canShare=false;try{canShare=Boolean(file&&navigator.canShare?.({files:[file]}));}catch{/* An unavailable share policy must not prevent preview or download. */}
 return <Modal title={name} onClose={onClose} className="attachment-viewer"><div className="attachment-actions">{blobUrl&&<a className="secondary-button compact" href={blobUrl} download={name}><Download size={16}/>下载原文件</a>}{canShare&&<button type="button" className="secondary-button compact" onClick={()=>{if(file)void navigator.share({files:[file],title:name}).catch(e=>{if(e?.name!=='AbortError')setError('当前环境无法保存或分享此文件，仍可查看或下载原文件。');});}}><Share2 size={16}/>保存／分享文件</button>}</div>
  {loading&&<p role="status">正在读取附件…</p>}{error&&<p className="feedback" role="alert">{error}</p>}
  {!loading&&!isPdf&&!isOffice&&<p className="notice">此文件可下载后查看；当前浏览器支持文件分享时，也可直接保存或分享。</p>}
  {office?.message&&<p className="muted-note">{office.message}</p>}
  {!loading&&count>1&&<nav className="attachment-pagination" aria-label="文档翻页"><button className="icon-button" aria-label="上一页" disabled={page===1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={20}/></button><span>{page} / {count}</span><button className="icon-button" aria-label="下一页" disabled={page===count} onClick={()=>setPage(p=>p+1)}><ChevronRight size={20}/></button></nav>}
  <div ref={container} className="attachment-document">{pdf&&<><canvas ref={canvas} aria-label={'PDF 第 '+page+' 页'}/>{rendering&&<p role="status">正在绘制…</p>}</>}{office?.pages[page-1]&&<Blocks blocks={office.pages[page-1].blocks}/>}</div>
 </Modal>;
}
