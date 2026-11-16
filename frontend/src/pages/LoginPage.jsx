import { useEffect, useState } from 'react';
import { Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { GOOGLE_SIGN_IN_URL, googleErrorMessage } from '../services/googleAuth.js';
import GoogleIcon from '../components/GoogleIcon.jsx';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(() => {
    if (location.state?.notice) return { type: 'success', text: location.state.notice };
    const oauthError = new URLSearchParams(location.search).get('oauth_error');
    const text = oauthError ? googleErrorMessage(oauthError) : null;
    return text ? { type: 'error', text } : null;
  });
  const redirectTo = location.state?.from || '/dashboard';

  useEffect(() => {
    if (notice?.type !== 'success') return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const updateField = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setNotice(null);

    try {
      setLoading(true);
      await login({ identifier: form.identifier, password: form.password, rememberMe });
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error.response?.data?.message || 'Incorrect credentials. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="auth-logo" aria-label="Jimvolt home"><img className="brand-logo auth-brand-image" src="/jimvolt-logo.png" alt="Jimvolt" /></Link>
        <div className="auth-header">
          <div className="auth-badge"><ShieldCheck size={22} /></div>
          <div>
            <p className="eyebrow">Welcome back</p>
            <h1>Login to your account</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Email, phone or username</span>
            <input name="identifier" value={form.identifier} onChange={updateField} placeholder="you@example.com, 0803... or username" autoComplete="username" />
          </label>

          <label className="field field-password">
            <span>Password</span>
            <div className="password-wrap">
              <input type={showPassword ? 'text' : 'password'} name="password" value={form.password} onChange={updateField} placeholder="Your password" />
              <button type="button" className="icon-btn" onClick={() => setShowPassword((current) => !current)} aria-label="Toggle password visibility">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <div className="row-between">
            <label className="check-row">
              <input type="checkbox" checked={rememberMe} onChange={() => setRememberMe((current) => !current)} />
              <span>Remember me</span>
            </label>
            <Link to="/forgot-password" className="link subtle-link">Forgot password?</Link>
          </div>

          {notice && <div className={`notice ${notice.type}`} role={notice.type === 'success' ? 'status' : 'alert'}>{notice.text}</div>}

          <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
            {loading ? <><LoaderCircle size={16} className="spin" /> Signing in...</> : 'Sign in'}
          </button>
        </form>

        <div className="auth-divider"><span>or</span></div>
        <a className="btn btn-white auth-google" href={GOOGLE_SIGN_IN_URL}>
          <GoogleIcon /> Continue with Google
        </a>

        <p className="auth-footer">
          New to Jimvolt? <Link to="/register">Create account</Link>
        </p>
      </div>
    </div>
  );
}
