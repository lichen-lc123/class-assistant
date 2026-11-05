import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {Check,ChevronDown,Search} from 'lucide-react';
import type {HomeworkTarget} from './types';

export function HomeworkCourseSelect({value,classes,selectedKeys,disabled,onType,onSelect}:{value:string;classes:HomeworkTarget[];selectedKeys:string[];disabled:boolean;onType:(value:string)=>void;onSelect:(course:HomeworkTarget)=>void}){
  const id=useId(),root=useRef<HTMLDivElement>(null),[open,setOpen]=useState(false),[filtering,setFiltering]=useState(false),[active,setActive]=useState(-1);
  const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/\s/g,'');
  const choices=classes.filter(c=>c.courseName?.trim()),query=filtering?normalize(value):'';
  const matches=choices.filter(c=>normalize(`${c.courseName} ${c.teacher||''} ${c.classCode||''}`).includes(query));
  useEffect(()=>{const outside=(event:Event)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};},[]);
  function choose(course:HomeworkTarget){onSelect(course);setOpen(false);setFiltering(false);setActive(-1);}
  function keys(event:KeyboardEvent<HTMLInputElement>){
    if(event.nativeEvent.isComposing)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActive(old=>event.key==='ArrowDown'?Math.min(open?old+1:0,matches.length-1):Math.max(open&&old>=0?old-1:matches.length-1,0));}
    else if(event.key==='Enter'&&open){event.preventDefault();if(active>=0&&matches[active])choose(matches[active]);else setOpen(false);}
    else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);}
    else if(event.key==='Tab')setOpen(false);
  }
  return <div className="homework-course-select" ref={root}><label htmlFor={id}>课程名称</label><div className="homework-course-input"><Search size={17} aria-hidden="true"/><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={id+'-options'} aria-describedby={id+'-hint'} aria-activedescendant={open&&active>=0&&matches[active]?id+'-option-'+active:undefined} autoComplete="off" required maxLength={160} value={value} placeholder="输入课程名前几个字搜索" disabled={disabled} onFocus={()=>{setOpen(true);setFiltering(false);setActive(-1);}} onChange={e=>{onType(e.target.value);setFiltering(true);setActive(0);setOpen(true);}} onKeyDown={keys}/><button type="button" className="homework-course-toggle" aria-label="展开本学期课程" aria-expanded={open} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>{setFiltering(false);setActive(-1);setOpen(!open);}}><ChevronDown size={18}/></button></div>
    {open&&<div className="homework-course-options" id={id+'-options'} role="listbox" aria-label="本学期课程">{matches.length?matches.map((course,i)=><button type="button" role="option" id={id+'-option-'+i} aria-selected={selectedKeys.includes(course.key)&&value===course.courseName} key={course.key} tabIndex={-1} className={i===active?'active':''} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(i)} onClick={()=>choose(course)}><span><strong>{course.courseName}</strong><small>{course.teacher||'老师待确认'} · 上课班 {course.classCode||'班号未录入'}</small></span>{selectedKeys.includes(course.key)&&value===course.courseName&&<Check size={17}/>}</button>):<p role="status">{choices.length?'没有找到匹配课程，换个关键词试试。':'本学期暂无可选课程，请先在课程管理中导入课表模板。'}</p>}</div>}
    <p id={id+'-hint'} className="muted-note">输入前几个字搜索本学期课程，选择后自动填写老师和对应上课班。</p>
  </div>;
}
