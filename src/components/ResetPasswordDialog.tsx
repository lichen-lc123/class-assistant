import { ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';

interface Props { onClose: () => void }

export function ResetPasswordDialog({ onClose }: Props) {
  return (
    <Modal title="联系班委重置" className="reset-dialog" onClose={onClose}>
      <div className="dialog-content">
        <span className="dialog-symbol"><ShieldCheck size={30} strokeWidth={1.6} /></span>
        <p id="reset-description">请联系班委，提供你的学号，由有账号管理权限的管理员为你重置密码。</p>
        <p className="dialog-note">管理员无法查看你的原密码。重置后，请使用新的临时密码登录并及时修改。</p>
        <button className="primary-button" type="button" onClick={onClose}>我知道了</button>
      </div>
    </Modal>
  );
}
