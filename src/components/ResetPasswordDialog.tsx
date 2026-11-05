import { useEffect, useRef } from 'react';
import { ShieldCheck, X } from 'lucide-react';

interface Props { onClose: () => void }

export function ResetPasswordDialog({ onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="reset-dialog" aria-labelledby="reset-title"
      aria-describedby="reset-description" onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog-content">
        <button className="icon-button dialog-close" type="button" aria-label="关闭" onClick={onClose}><X size={20} /></button>
        <span className="dialog-symbol"><ShieldCheck size={30} strokeWidth={1.6} /></span>
        <h2 id="reset-title">联系班委重置</h2>
        <p id="reset-description">请联系班委，提供你的学号，由有账号管理权限的管理员为你重置密码。</p>
        <p className="dialog-note">管理员无法查看你的原密码。重置后，请使用新的临时密码登录并及时修改。</p>
        <button className="primary-button" type="button" onClick={onClose}>我知道了</button>
      </div>
    </dialog>
  );
}
