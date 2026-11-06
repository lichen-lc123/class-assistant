import {useEffect,useState} from 'react';
export const mobileLayoutQuery='(max-width: 800px), (pointer: coarse) and (max-width: 1100px)';
export function useMobileLayout(){
  const [mobile,setMobile]=useState(()=>window.matchMedia(mobileLayoutQuery).matches);
  useEffect(()=>{const query=window.matchMedia(mobileLayoutQuery),update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
  return mobile;
}
