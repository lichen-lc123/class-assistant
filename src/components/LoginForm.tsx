import { useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import { ApiError, login, type LoginHandler, type LoginResult } from '../services/auth';

interface Props {
  onResetPassword: () => void;
  onLogin?: LoginHandler;
  onAuthenticated?: (result: LoginResult) => void;
}

export function LoginForm({ onResetPassword, onLogin = login, onAuthenticated }: Props) {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ studentId?: string; password?: string }>({});
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const studentIdInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const nextErrors = {
      studentId: studentId.trim() ? undefined : '请输入学号',
      password: password ? undefined : '请输入密码',
    };
    setErrors(nextErrors);
    setMessage('');
    if (nextErrors.studentId || nextErrors.password) {
      (nextErrors.studentId ? studentIdInput : passwordInput).current?.focus();
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await onLogin({ studentId: studentId.trim(), password });
      setPassword('');
      setShowPassword(false);
      onAuthenticated?.(result);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : '暂时无法登录，请稍后重试或联系班委。');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section className="login-card" aria-labelledby="login-title">
      <header className="form-heading">
        <span className="eyebrow">欢迎回来</span>
        <h2 id="login-title">学号登录</h2>
        <p>使用管理员分配的账号登录</p>
      </header>
      <form onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <div className="field-group">
          <label htmlFor="student-id">学号</label>
          <div className={`input-shell ${errors.studentId ? 'input-error' : ''}`}>
            <UserRound size={21} strokeWidth={1.6} aria-hidden="true" />
            <input ref={studentIdInput} id="student-id" name="username" type="text" autoComplete="username"
              placeholder="请输入学号" value={studentId} disabled={submitting} required
              aria-invalid={Boolean(errors.studentId)} aria-describedby={errors.studentId ? 'student-id-error' : undefined}
              onChange={(event) => { setStudentId(event.target.value); setErrors((current) => ({ ...current, studentId: undefined })); setMessage(''); }} />
          </div>
          {errors.studentId && <p className="field-error" id="student-id-error">{errors.studentId}</p>}
        </div>
        <div className="field-group password-field">
          <label htmlFor="password">密码</label>
          <div className={`input-shell ${errors.password ? 'input-error' : ''}`}>
            <LockKeyhole size={21} strokeWidth={1.6} aria-hidden="true" />
            <input ref={passwordInput} id="password" name="password" type={showPassword ? 'text' : 'password'}
              autoComplete="current-password" placeholder="请输入密码" value={password} disabled={submitting} required
              aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'password-error' : undefined}
              onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: undefined })); setMessage(''); }} />
            <button className="icon-button visibility-button" type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'}
              aria-pressed={showPassword} disabled={submitting} onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? <EyeOff size={20} strokeWidth={1.6} /> : <Eye size={20} strokeWidth={1.6} />}
            </button>
          </div>
          {errors.password && <p className="field-error" id="password-error">{errors.password}</p>}
        </div>
        <div className="reset-row"><button className="text-button" type="button" onClick={onResetPassword}>联系班委重置</button></div>
        <div className="form-status" aria-live="polite" aria-atomic="true">
          {message && <p className="status-error"><AlertCircle size={16} aria-hidden="true" />{message}</p>}
        </div>
        <button className="primary-button login-button" type="submit" disabled={submitting}>
          {submitting ? <><LoaderCircle size={19} className="spinner" aria-hidden="true" />正在登录</> : <><span>登录</span><ArrowRight size={18} strokeWidth={1.7} aria-hidden="true" /></>}
        </button>
      </form>
      <div className="security-note">
        <span className="security-icon"><ShieldCheck size={25} strokeWidth={1.6} aria-hidden="true" /></span>
        <div><p>首次登录后请修改初始密码</p><p>忘记密码请联系班委重置</p></div>
      </div>
    </section>
  );
}
