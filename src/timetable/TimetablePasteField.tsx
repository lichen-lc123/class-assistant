import {useId,useRef,useState,type ClipboardEvent,type ChangeEvent} from 'react';
import {ArrowDown,ClipboardPaste,Maximize2} from 'lucide-react';
import {Modal} from '../components/Modal';
import {timetablePasteStatus} from '../../shared/timetable-paste.mjs';

export function TimetablePasteField({value,disabled,onChange}:{value:string;disabled:boolean;onChange:(text:string)=>void}){
 const [expanded,setExpanded]=useState(false),id=useId(),input=useRef<HTMLTextAreaElement>(null),largeInput=useRef<HTMLTextAreaElement>(null);
 const [pasteMessage,setPasteMessage]=useState(''),[reading,setReading]=useState(false);
 const status=timetablePasteStatus(value);
 const feedback=<p id={id+'-status'} className={'ai-paste-status '+(status.state==='complete'?'is-complete':status.state.startsWith('missing')||status.state==='invalid-markers'?'is-incomplete':'')}><span>已输入 {status.characters.toLocaleString('zh-CN')} 字符</span><span>{status.message}</span></p>;
 function showEnd(large=false){const el=(large?largeInput:input).current;if(!el)return;el.focus({preventScroll:true});el.setSelectionRange(value.length,value.length);el.scrollTop=el.scrollHeight;}
 function handlePaste(event:ClipboardEvent<HTMLTextAreaElement>){
  const content=event.clipboardData.getData('text/plain');if(!content)return;
  // Read the complete plain-text paste before the WebView's default insertion.
  // Keep selection replacement semantics and never shorten the pasted string.
  event.preventDefault();const el=event.currentTarget,start=el.selectionStart,end=el.selectionEnd,next=el.value.slice(0,start)+content+el.value.slice(end),cursor=start+content.length;
  onChange(next);setPasteMessage('本次已粘贴 '+content.length.toLocaleString('zh-CN')+' 字符。');requestAnimationFrame(()=>{el.setSelectionRange(cursor,cursor);el.scrollTop=el.scrollHeight;});
 }
 async function readClipboard(append=false,large=false){
  const el=(large?largeInput:input).current;if(!el)return;
  if(!navigator.clipboard?.readText){if(append)showEnd(large);else el.focus();setPasteMessage(append?'已定位到结尾，请长按输入框粘贴剩余内容。':'请长按输入框粘贴；内容较长时也可分段追加。');return;}
  setReading(true);try{const content=await navigator.clipboard.readText();if(!content){setPasteMessage('剪贴板为空，请先复制课表。');return;}onChange(append?el.value+content:content);setPasteMessage('本次已粘贴 '+content.length.toLocaleString('zh-CN')+' 字符。');requestAnimationFrame(()=>{el.focus({preventScroll:true});el.setSelectionRange(el.value.length,el.value.length);el.scrollTop=el.scrollHeight;});}catch{if(append)showEnd(large);else el.focus();setPasteMessage('当前环境无法直接读取剪贴板，请长按输入框粘贴；也可分段追加。');}finally{setReading(false);}
 }
 const options={value,disabled:disabled||reading,spellCheck:false,autoCorrect:'off',autoCapitalize:'off',wrap:'soft' as const,onPaste:handlePaste,onChange:(event:ChangeEvent<HTMLTextAreaElement>)=>{onChange(event.target.value);setPasteMessage('');}};
 const pasteButtons=(large=false)=><div className="ai-paste-buttons"><button type="button" className="secondary-button compact" disabled={disabled||reading} onClick={()=>void readClipboard(false,large)}><ClipboardPaste size={15}/>{reading?'读取中…':value?'替换粘贴':'粘贴课表'}</button>{value&&<button type="button" className="secondary-button compact" disabled={disabled||reading} onClick={()=>void readClipboard(true,large)}>继续追加</button>}<button type="button" className="text-button" disabled={disabled||!value} onClick={()=>showEnd(large)}><ArrowDown size={14}/>查看结尾</button></div>;
 return <><div className="ai-paste-field"><div className="ai-paste-heading"><label htmlFor={id}>AI 整理结果</label><button type="button" className="text-button" disabled={disabled||reading} onClick={()=>setExpanded(true)}><Maximize2 size={15}/>放大编辑</button></div><textarea {...options} id={id} ref={input} aria-label="AI 整理的课表内容" aria-describedby={id+'-status'} rows={10} placeholder="粘贴从【课表开始】到【课表结束】的全部内容"/>{!expanded&&feedback}{pasteButtons()}{pasteMessage&&!expanded&&<p className="ai-paste-status" role="status">{pasteMessage}</p>}<small className="ai-paste-help">可滚动或放大查看全部内容，也支持分段追加。</small></div>{expanded&&<Modal title="编辑课表内容" className="ai-paste-dialog" onClose={()=>setExpanded(false)}><div className="manage-form timetable-paste-editor">{feedback}<textarea {...options} ref={largeInput} aria-label="放大编辑课表内容" aria-describedby={id+'-status'} autoFocus placeholder="粘贴完整课表内容"/>{pasteButtons(true)}{pasteMessage&&<p className="ai-paste-status" role="status">{pasteMessage}</p>}<div className="ai-paste-editor-actions"><button type="button" className="primary-button" onClick={()=>setExpanded(false)}>完成编辑</button></div></div></Modal>}</>;
}
