import {useState} from 'react';
import {Eye,EyeOff} from 'lucide-react';
export function PasswordInput({label,value,onChange,disabled=false,newPassword=false}:{label:string;value:string;onChange:(v:string)=>void;disabled?:boolean;newPassword?:boolean}){
  const [visible,setVisible]=useState(false),[capsLock,setCapsLock]=useState(false);
  return <label>{label}<span className="account-password-input"><input type={visible?'text':'password'} required autoComplete={newPassword?'new-password':'current-password'} value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} minLength={newPassword?8:undefined} maxLength={newPassword?32:128} placeholder={newPassword?'8—32 位，包含字母和数字':'请输入当前密码'} onKeyUp={e=>setCapsLock(e.getModifierState('CapsLock'))} onBlur={()=>setCapsLock(false)}/><button type="button" className="password-eye" aria-label={`${visible?'隐藏':'显示'}${label}`} aria-pressed={visible} disabled={disabled} onClick={()=>setVisible(v=>!v)}>{visible?<EyeOff size={19}/>:<Eye size={19}/>}</button></span>{capsLock&&<small className="password-hint">大写锁定已开启</small>}</label>;
}
