import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { LoginForm } from '../components/LoginForm';
import { ResetPasswordDialog } from '../components/ResetPasswordDialog';
import type { User } from '../services/auth';

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [resetOpen, setResetOpen] = useState(false);
  return (
    <main className="login-page">
      <section className="story-panel" aria-labelledby="brand-title">
        <a className="brand" href="/" aria-label="作业提醒首页">
          <span className="brand-icon"><ClipboardCheck size={25} strokeWidth={1.8} /></span><span>作业提醒</span>
        </a>
        <div className="story-content">
          <span className="story-kicker">把每一份认真，安排妥当</span>
          <h1 id="brand-title"><span className="desktop-title">每一份作业<br />都从容完成</span><span className="mobile-title">作业提醒</span></h1>
          <p className="story-description"><span className="desktop-copy">查看班级作业，及时接收提醒。</span><span className="mobile-copy">每一份作业，都从容完成</span></p>
          <div className="illustration-wrap" aria-hidden="true"><img src="/images/login-illustration.png" alt="" className="login-illustration" fetchPriority="high" /></div>
        </div>
        <span className="story-footnote">专注当下的学习，剩下的交给提醒。</span>
      </section>
      <section className="form-panel" aria-label="登录">
        <div className="form-container"><LoginForm onResetPassword={() => setResetOpen(true)} onAuthenticated={onAuthenticated} />
          <footer className="page-footer"><span />让学习有条不紊<span /></footer>
        </div>
      </section>
      {resetOpen && <ResetPasswordDialog onClose={() => setResetOpen(false)} />}
    </main>
  );
}
