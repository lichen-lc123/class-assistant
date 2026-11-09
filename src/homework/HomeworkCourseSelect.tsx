import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {Check,ChevronDown,Search} from 'lucide-react';
import type {HomeworkTarget} from './types';

export function HomeworkCourseSelect({value,classes,selectedKeys,disabled,personal=false,multiple=false,required=true,onType,onSelect}:{value:string;classes:HomeworkTarget[];selectedKeys:string[];disabled:boolean;personal?:boolean;multiple?:boolean;required?:boolean;onType:(value:string)=>void;onSelect:(course:HomeworkTarget)=>void}){
  const id=useId(),root=useRef<HTMLDivElement>(null),[open,setOpen]=useState(false),[filtering,setFiltering]=useState(false),[active,setActive]=useState(-1);
  const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/\s/g,'');
  const [searchValue,setSearchValue]=useState('');
  const choices=classes.filter(c=>c.courseName?.trim()),query=filtering?normalize(multiple?searchValue:value):'';
  const matches=choices.filter(c=>normalize(`${c.courseName} ${c.teacher||''} ${c.timeLabel||''}`).includes(query));
  useEffect(()=>{const outside=(event:Event)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};},[]);
  function choose(course:HomeworkTarget){onSelect(course);setOpen(multiple);setFiltering(false);setSearchValue('');setActive(-1);}
  function keys(event:KeyboardEvent<HTMLInputElement>){
    if(event.nativeEvent.isComposing)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActive(old=>event.key==='ArrowDown'?Math.min(open?old+1:0,matches.length-1):Math.max(open&&old>=0?old-1:matches.length-1,0));}
    else if(event.key==='Enter'&&open){event.preventDefault();if(active>=0&&matches[active])choose(matches[active]);else setOpen(false);}
    else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);}
    else if(event.key==='Tab')setOpen(false);
  }
  return <div className="homework-course-select" ref={root}><label htmlFor={id}>课程名称</label><div className="homework-course-input"><Search size={17} aria-hidden="true"/><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={id+'-options'} aria-describedby={id+'-hint'} aria-activedescendant={open&&active>=0&&matches[active]?id+'-option-'+active:undefined} autoComplete="off" required={required} maxLength={160} value={multiple&&filtering?searchValue:value} placeholder="输入课程名前几个字搜索" disabled={disabled} onFocus={()=>{setOpen(true);setFiltering(false);setActive(-1);}} onChange={e=>{setSearchValue(e.target.value);if(!multiple||!selectedKeys.length)onType(e.target.value);setFiltering(true);setActive(0);setOpen(true);}} onKeyDown={keys}/><button type="button" className="homework-course-toggle" aria-label={personal?'展开我的课表课程':'展开本学期课程'} aria-expanded={open} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>{setFiltering(false);setActive(-1);setOpen(!open);}}><ChevronDown size={18}/></button></div>
    {open&&<div className="homework-course-options" id={id+'-options'} role="listbox" aria-multiselectable={multiple||undefined} aria-label={personal?'我的课表课程':'本学期课程'}>{matches.length?matches.map((course,i)=><button type="button" role="option" id={id+'-option-'+i} aria-selected={selectedKeys.includes(course.key)&&(multiple||value===course.courseName)} key={course.key} tabIndex={-1} className={i===active?'active':''} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(i)} onClick={()=>choose(course)}><span><strong>{course.courseName}</strong><small>{course.teacher||'老师待确认'} · {course.timeLabel||'上课时间待安排'}</small></span>{selectedKeys.includes(course.key)&&(multiple||value===course.courseName)&&<Check size={17}/>}</button>):<p role="status">{choices.length?'没有找到匹配课程，换个关键词试试。':personal?'本学期课表中还没有课程，请先到课表管理添加课程。':'本学期暂无可选课程，请先在课程管理中导入课表模板。'}</p>}</div>}
    {multiple&&selectedKeys.length>0&&<div className="homework-course-selected" aria-label="已选适用课程">{classes.filter(c=>selectedKeys.includes(c.key)).map(c=><button type="button" key={c.key} disabled={disabled} onClick={()=>choose(c)} title={c.label} aria-label={'移除课程：'+c.label}><span>{c.courseName} · {c.teacher} · {c.timeLabel}</span><span aria-hidden="true">×</span></button>)}</div>}
    <p id={id+'-hint'} className="muted-note">{personal?'仅能选择自己该学期课表中的课程，选中后自动带出老师。':multiple?'支持多选适用课程，已选课程可点击移除；没有明确上课时间的表格默认关联同名同老师的所有课程。':'输入前几个字搜索本学期课程，选择后自动填写老师，并按上课时间关联对应课程。'}</p>
  </div>;
}
