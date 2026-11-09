import {useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {useMobileLayout} from '../components/useMobileLayout';

export function TemplateUsers({names=[]}:{names?:string[]}){
  const mobile=useMobileLayout(),viewport=useRef<HTMLParagraphElement>(null),content=useRef<HTMLSpanElement>(null);
  const [distance,setDistance]=useState(0);
  const text='使用该模板的同学：'+(names.length?names.join('、'):'暂无');
  useLayoutEffect(()=>{
    if(!mobile){setDistance(0);return;}
    const box=viewport.current,line=content.current;if(!box||!line)return;
    const measure=()=>{const width=Math.ceil(line.getBoundingClientRect().width);setDistance(width>box.clientWidth+1?width+24:0);};
    measure();const observer=new ResizeObserver(measure);observer.observe(box);observer.observe(line);
    return()=>observer.disconnect();
  },[text,mobile]);
  if(!mobile)return <p className="template-users" title={text}>{text}</p>;
  const style={'--template-users-shift':`-${distance}px`,'--template-users-duration':`${distance/22+3}s`} as CSSProperties;
  return <p ref={viewport} className={'template-users template-users-mobile'+(distance?' is-scrolling':'')} title={text} style={style}><span className="template-users-track" key={text}><span ref={content}>{text}</span>{distance>0&&<span aria-hidden="true">{text}</span>}</span></p>;
}
