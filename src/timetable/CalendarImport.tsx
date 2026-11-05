import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { Copy, FileImage, Upload } from 'lucide-react';
import { api } from '../services/auth';
import { errorMessage, type Term } from './types';

export type CalendarDraft=Pick<Term,'academicYear'|'name'|'startsOn'|'endsOn'|'config'>;
interface Preview {term:CalendarDraft;warnings:string[]}
export function CalendarImport({onApply,onPendingChange,target}:{onApply:(draft:CalendarDraft)=>void;onPendingChange?:(pending:boolean)=>void;target?:Pick<Term,'academicYear'|'name'>}){
  const [text,setText]=useState(''),[prompt,setPrompt]=useState(''),[image,setImage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [imageName,setImageName]=useState('');
  const [lastApplied,setLastApplied]=useState<string|null>(null);
  const request=useRef(0),lastRequested=useRef('');
  useEffect(()=>()=>{if(image.startsWith('blob:'))URL.revokeObjectURL(image);},[image]);
  useEffect(()=>{onPendingChange?.(busy||(lastApplied!==null?text.trim()!==lastApplied:Boolean(text.trim())));},[busy,text,lastApplied,onPendingChange]);
  useEffect(()=>{
    const value=text.trim();if(busy||!value||value===lastApplied||value===lastRequested.current)return;
    const timer=window.setTimeout(()=>{try{JSON.parse(value.replace(/^\uFEFF/,'').replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i,'$1'));}catch{return;}void inspect(value);},600);
    return()=>clearTimeout(timer);
  },[text,lastApplied,busy]);
  async function copyPrompt(){setBusy(true);setError('');try{const result=await api<{text:string}>('/admin/timetable/calendar-prompt');const value=result.text+(target?`\n\n当前在编辑已存在的学期：${target.academicYear} · ${target.name}。如果图片确属此学期，输出 semester 使用现有名称，不更改学期身份；如果图片不属于此学期，明确在 warnings 中说明，不将其他学期的日期改造成此学期。`:'');setPrompt(value);try{await navigator.clipboard.writeText(value);setNotice('完整提示词已复制。将它和校历图片一起交给 AI，返回结果包含全部表单字段，粘贴后自动生成核对表。');}catch{setNotice('完整提示词已展开，可手动复制后与图片一起交给外部 AI。');}}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  function changeText(value:string){request.current++;setText(value);setBusy(false);setError('');setNotice('');onPendingChange?.(true);}
  async function inspect(value=text){const token=++request.current;lastRequested.current=value.trim();setBusy(true);setError('');setNotice('');try{const result=await api<Preview>('/admin/timetable/calendar-preview','POST',{text:value});if(token!==request.current)return;onApply(result.term);setLastApplied(value.trim());setNotice('全部字段已自动导入。直接核对下方校历，确认无误即可保存，无需逐项填写或选择。');}catch(e){if(token===request.current)setError(errorMessage(e));}finally{if(token===request.current)setBusy(false);}}
  async function example(){setBusy(true);setError('');try{const data=await api<unknown>('/admin/timetable/calendar-example');const value=JSON.stringify(data,null,2);setText(value);setImage('/calendar-reference-2026.png');setImageName('本次校历示例');await inspect(value);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  function chooseImage(file?:File){if(busy||!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024){setError('请选择不超过 5 MB 的 PNG、JPG 或 WebP 图片。');return;}setImage(URL.createObjectURL(file));setImageName(file.name||'已粘贴的校历图片');setError('');}
  function pasteImage(event:ClipboardEvent<HTMLElement>){
    if(busy)return;
    const item=Array.from(event.clipboardData.items).find(item=>item.kind==='file'&&item.type.startsWith('image/'));
    const file=item?.getAsFile()||Array.from(event.clipboardData.files).find(file=>file.type.startsWith('image/'));
    if(!file)return;
    event.preventDefault();chooseImage(file);
  }
  async function chooseJson(file?:File){if(!file)return;if(file.size>1024*1024){setError('提取结果文件不能超过 1 MB。');return;}try{const value=await file.text();changeText(value);await inspect(value);}catch{setError('结果文件读取失败，请重新选择或直接粘贴。');}}
  function pasteResult(event:ClipboardEvent<HTMLTextAreaElement>){if(Array.from(event.clipboardData.items).some(item=>item.type.startsWith('image/')))return;const value=event.clipboardData.getData('text/plain');if(!value.trim()||busy)return;event.preventDefault();changeText(value);void inspect(value);}
  return <details className="calendar-import-panel" open onPaste={pasteImage}><summary><strong>一次导入，自动生成学期与校历</strong></summary><p>① 复制完整提示词，与图片一起交给 AI → ② 粘贴 AI 返回结果，自动填入全部字段 → ③ 核对校历并保存。</p>
    <div className="calendar-import-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>void copyPrompt()}><Copy size={15}/>复制完整校历提示词</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>void example()}>载入本次校历示例</button></div>
    <label>粘贴 AI 返回的完整结果，自动导入<textarea rows={5} value={text} disabled={busy} onPaste={pasteResult} onChange={e=>changeText(e.target.value)} placeholder="在这里直接粘贴 AI 返回的完整 JSON，学期、教学周、全部作息和事项将自动填写"/></label><label>或选择 AI 返回的结果文件（选择后自动导入）<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>void chooseJson(e.target.files?.[0])}/></label>
    {busy&&<p role="status" className="muted-note">正在读取结果并生成核对表…</p>}
    {error&&<><p className="feedback" role="alert">{error}</p><p className="muted-note">可将此问题连同原结果交给 AI，要求按完整提示词重新输出，再粘贴回来。</p><button type="button" className="secondary-button" disabled={busy||!text.trim()} onClick={()=>void inspect()}><Upload size={15}/>重新解析当前结果</button></>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    <details className="calendar-image-reference"><summary>添加原图核对（可选，支持粘贴图片）</summary><div className="calendar-image-input" role="group" aria-label="校历图片，支持粘贴或选择文件" tabIndex={busy?-1:0} onClick={e=>{if(e.target instanceof Element&&!e.target.closest('input,label,button'))e.currentTarget.focus();}}><FileImage size={25}/><strong>点击此区域，按 Ctrl+V 粘贴校历图片</strong><span>支持复制的截图或图片，PNG、JPG、WebP，最大 5 MB</span><label>也可选择本地图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>chooseImage(e.target.files?.[0])}/></label>{imageName&&<p role="status">已载入：{imageName}</p>}</div><p className="muted-note">网站没有内置 AI，原图只用于本机核对。把图片和提示词交给外部 AI 后，将结果粘贴到上方即可。</p></details>
    {image&&<details className="calendar-source-image" open><summary>原始校历图片</summary><a href={image} target="_blank" rel="noreferrer"><img src={image} alt="管理员提供的原始校历，供与自动生成的表格逐项核对"/></a></details>}
    {prompt&&<details><summary>查看并手动复制完整提示词</summary><textarea aria-label="校历提取提示词" readOnly rows={7} value={prompt}/></details>}
  </details>;
}
