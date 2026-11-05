import { useEffect, useState, type FormEvent } from 'react';
import { Download, Plus, Search, Upload, UsersRound, ShieldCheck, RefreshCw } from 'lucide-react';
import { api, type User } from '../services/auth';
import { Modal } from '../components/Modal';
type Action = { type: 'create' } | { type: 'edit' | 'reset' | 'delete'; user: User } | { type: 'import' };
interface ImportResult { created: number; skipped: { studentId: string; reason: string }[]; invalid: { line: number; studentId: string; reason: string }[] }
export function UserManagement({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  async function load() {
    setLoading(true); setLoadError('');
    try { setUsers(await api<User[]>('/admin/users')); } catch (error) { setLoadError(error instanceof Error ? error.message : '加载失败。'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const visible = users.filter((user) => `${user.studentId} ${user.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const countAdmins = users.filter((user) => user.role === 'admin').length;
  return <>
    <div className="stats-row"><section className="stat-card"><UsersRound size={23} /><div><span>全部账号</span><strong>{users.length}</strong></div></section><section className="stat-card"><ShieldCheck size={23} /><div><span>管理员</span><strong>{countAdmins}</strong></div></section><section className="stat-card"><UsersRound size={23} /><div><span>学生</span><strong>{users.length - countAdmins}</strong></div></section></div>
    <section className="workspace-card users-card">
      <div className="section-heading"><div><h2>账号管理</h2><p>维护学号、姓名与角色，管理账号访问权限。</p></div><div className="toolbar-actions"><button className="secondary-button" onClick={() => setAction({ type: 'import' })}><Upload size={17} />批量导入</button><button className="primary-button compact" onClick={() => setAction({ type: 'create' })}><Plus size={18} />创建账号</button></div></div>
      <div className="table-toolbar"><label className="search-box"><Search size={18} /><input aria-label="搜索学号或姓名" placeholder="搜索学号或姓名" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="icon-button" aria-label="刷新账号列表" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /></button></div>
      {notice && <p className="notice" role="status">{notice}</p>}{loadError && <p className="feedback" role="alert">{loadError}</p>}
      <div className="table-scroll"><table><thead><tr><th>学号 / 账号</th><th>姓名</th><th>角色</th><th>密码状态</th><th>操作</th></tr></thead><tbody>
        {visible.map((user) => <tr key={user.id}><td className="student-id">{user.studentId}{user.id === currentUser.id && <span className="self-tag">本人</span>}</td><td>{user.name}</td><td><span className={`role-badge ${user.role === 'student' ? 'student-badge' : ''}`}>{user.role === 'admin' ? '管理员' : '学生'}</span></td><td><span className={user.mustChangePassword ? 'pending-status' : 'subtle-text'}>{user.mustChangePassword ? '待修改初始密码' : '已设置'}</span></td><td><div className="row-actions"><button onClick={() => setAction({ type: 'edit', user })}>编辑</button><button disabled={user.id === currentUser.id} title={user.id === currentUser.id ? '请在我的账号中修改密码' : undefined} onClick={() => setAction({ type: 'reset', user })}>重置密码</button><button className="danger-text" disabled={user.id === currentUser.id} onClick={() => setAction({ type: 'delete', user })}>删除</button></div></td></tr>)}
      </tbody></table></div>
      {!visible.length && !loadError && <p className="empty-state">{loading ? '正在加载账号…' : query ? '没有找到匹配的账号。' : '暂无账号。'}</p>}
      <footer className="table-footer">共 {visible.length} 个账号<span>已有学号不会被重复导入或覆盖密码</span></footer>
    </section>
    {action && <AccountAction key={action.type + ('user' in action ? action.user.id : '')} action={action} onClose={() => setAction(null)} onSaved={(message) => { setNotice(message); void load(); window.dispatchEvent(new Event('account-updated')); }} />}
  </>;
}
function AccountAction({ action, onClose, onSaved }: { action: Action; onClose: () => void; onSaved: (message: string) => void }) {
  const target = 'user' in action ? action.user : undefined;
  const [studentId, setStudentId] = useState(target?.studentId || '');
  const [name, setName] = useState(target?.name || '');
  const [role, setRole] = useState<User['role']>(target?.role || 'student');
  const [password, setPassword] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const titles = { create: '创建账号', edit: '编辑账号', reset: '重置密码', delete: '删除账号', import: '批量导入账号' };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError(''); setBusy(true);
    try {
      if (action.type === 'import') {
        const summary = await api<ImportResult>('/admin/users/import', 'POST', { text, password });
        setResult(summary); setPassword(''); onSaved(`已创建 ${summary.created} 个账号，跳过 ${summary.skipped.length} 个重复学号，${summary.invalid.length} 行需修正。`); return;
      }
      if (action.type === 'create') await api('/admin/users', 'POST', { studentId, name, role, password });
      if (action.type === 'edit') await api(`/admin/users/${action.user.id}`, 'PATCH', { studentId, name, role });
      if (action.type === 'reset') await api(`/admin/users/${action.user.id}/reset-password`, 'POST', { password });
      if (action.type === 'delete') await api(`/admin/users/${action.user.id}`, 'DELETE');
      setPassword(''); onSaved(`${titles[action.type]}成功。`); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败。'); }
    finally { setBusy(false); }
  }
  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > 1024 * 1024) { setError('文件不能超过 1 MB。'); return; }
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) { setError('请将 Excel 另存为 CSV，或直接复制两列内容粘贴。'); return; }
    const buffer = await file.arrayBuffer(); let content = new TextDecoder().decode(buffer);
    if (content.includes('\uFFFD')) content = new TextDecoder('gb18030').decode(buffer);
    setText(content); setResult(null); setError('');
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob(['\uFEFF学号,姓名\r\n20260001,张三\r\n20260002,李四\r\n'], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '账号导入模板.csv'; link.click(); URL.revokeObjectURL(url);
  }
  return <Modal title={titles[action.type]} onClose={onClose} busy={busy}><form className="manage-form" onSubmit={submit}>
      {action.type === 'delete' && <><p>确定删除 <strong>{target?.name}（{target?.studentId}）</strong> 的账号吗？</p><p className="delete-warning">删除后将立即退出所有设备，无法再登录。此操作无法撤销。</p></>}
      {['create', 'edit'].includes(action.type) && <><label>学号 / 账号<input value={studentId} onChange={(event) => setStudentId(event.target.value)} required maxLength={40} pattern="[a-zA-Z0-9_\-]+" autoComplete="off" disabled={busy} /></label><label>姓名<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} disabled={busy} /></label><label>角色<select value={role} onChange={(event) => setRole(event.target.value as User['role'])} disabled={busy}><option value="student">学生</option><option value="admin">管理员</option></select></label></>}
      {action.type === 'reset' && <p className="section-description">为 {target?.name}（{target?.studentId}）设置新的临时密码，原密码无法查看。重置后，该账号所有设备将退出登录。</p>}
      {action.type === 'import' && !result && <><p className="section-description">上传 CSV，或从 Excel 复制“学号、姓名”两列后粘贴。每次最多 500 个，统一创建为学生账号。</p><div className="import-actions"><label className="secondary-button upload-label"><Upload size={16} />选择文件<input type="file" accept=".csv,.tsv,.txt" onChange={(event) => void readFile(event.target.files?.[0])} disabled={busy} /></label><button type="button" className="secondary-button" onClick={downloadTemplate}><Download size={16} />下载模板</button></div><label>学号、姓名<textarea value={text} onChange={(event) => setText(event.target.value)} required rows={7} placeholder={'学号,姓名\n20260001,张三\n20260002,李四'} disabled={busy} /></label><p className="import-rule">重复学号自动跳过，不修改原姓名、角色或密码。请将 Excel 学号列设为文本，保留开头的 0。</p></>}
      {['create', 'reset', 'import'].includes(action.type) && !result && <label>{action.type === 'import' ? '统一初始密码' : action.type === 'reset' ? '新的临时密码' : '初始密码'}<input type="password" autoComplete="new-password" placeholder="8—128 位，首次登录后需修改" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={128} disabled={busy} /></label>}
      {result && <div className="import-result" role="status"><h3>导入完成</h3><p>成功创建 {result.created} 个 · 重复跳过 {result.skipped.length} 个 · 无效 {result.invalid.length} 行</p>{result.skipped.length > 0 && <details><summary>查看重复学号</summary><ul>{result.skipped.map((item, index) => <li key={index}>{item.studentId}：{item.reason}</li>)}</ul></details>}{result.invalid.length > 0 && <details open><summary>查看需修正的内容</summary><ul>{result.invalid.map((item, index) => <li key={index}>数据第 {item.line} 行 {item.studentId}：{item.reason}</li>)}</ul></details>}<p>请将初始密码告知对应同学，首次登录后需要修改。</p></div>}
      <p className="feedback" role="alert">{error}</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>{result ? '完成' : '取消'}</button>{!result && <button className={`primary-button compact ${action.type === 'delete' ? 'danger-button' : ''}`} disabled={busy}>{busy ? '正在处理…' : action.type === 'delete' ? '确认删除' : action.type === 'import' ? '开始导入' : '保存'}</button>}</div>
    </form></Modal>;
}
