import { PasswordInput } from '../components/PasswordInput';
import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, type User } from '../services/auth';
export function AccountSettings({ user, onUpdated }: { user: User; onUpdated: (user: User) => void }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setMessage(''); setSuccess(false);
    if (newPassword !== confirmation) { setMessage('两次输入的新密码不一致。'); return; }
    if(newPassword===oldPassword){setMessage('新密码不能与当前密码相同。');return;}
    if(!/^(?=.*[A-Za-z])(?=.*[0-9])[^\s]{8,32}$/.test(newPassword)){setMessage('新密码需为 8—32 位，包含字母和数字，可使用符号，不含空格。');return;}
    setBusy(true);
    try {
      const updated = await api<User>('/auth/password', 'POST', { oldPassword, newPassword });
      setOldPassword(''); setNewPassword(''); setConfirmation(''); setSuccess(true); setMessage('密码已修改，其他设备需要重新登录。'); onUpdated(updated);
    } catch (error) { setMessage(error instanceof Error ? error.message : '修改失败。'); }
    finally { setBusy(false); }
  }
  return <div className="account-content">
    {user.mustChangePassword && <div className="info-banner"><ShieldCheck size={20} /><span>为保护账号，请先修改初始密码，再继续使用。</span></div>}
    <section className="workspace-card profile-summary"><span className="avatar">{user.name.slice(0, 1)}</span><div><h2>{user.name}</h2><p>学号 / 账号：{user.studentId}</p></div><span className="role-badge">{user.role === 'admin' ? '管理员' : '学生'}</span></section>
    <section className="workspace-card password-card"><h2>修改密码</h2><p className="section-description">密码仅由你掌握，管理员只能重置，无法查看。</p>
      <form onSubmit={submit} className="manage-form">
        <PasswordInput label="当前密码" value={oldPassword} onChange={setOldPassword} disabled={busy}/>
        <PasswordInput label="新密码" value={newPassword} onChange={setNewPassword} disabled={busy} newPassword/>
        <PasswordInput label="确认新密码" value={confirmation} onChange={setConfirmation} disabled={busy} newPassword/>
        <p className="muted-note">8—32 位，包含字母和数字，可使用符号，不含空格。</p>
        <p className={`feedback ${success ? 'feedback-success' : ''}`} role="status">{message}</p>
        <button className="primary-button" disabled={busy}>{busy ? '正在保存…' : '保存新密码'}</button>
      </form>
    </section>
  </div>;
}
