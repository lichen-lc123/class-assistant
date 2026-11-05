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
        <label>当前密码<input type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required maxLength={128} disabled={busy} /></label>
        <label>新密码<input type="password" autoComplete="new-password" placeholder="8—128 位" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} maxLength={128} disabled={busy} /></label>
        <label>确认新密码<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={8} maxLength={128} disabled={busy} /></label>
        <p className={`feedback ${success ? 'feedback-success' : ''}`} role="status">{message}</p>
        <button className="primary-button" disabled={busy}>{busy ? '正在保存…' : '保存新密码'}</button>
      </form>
    </section>
  </div>;
}
