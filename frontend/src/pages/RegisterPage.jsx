import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, LoaderCircle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { isValidNigerianPhone } from '../utils/phone.js';
import { checkUsername } from '../services/sellerService.js';
import { GOOGLE_SIGN_IN_URL } from '../services/googleAuth.js';
import GoogleIcon from '../components/GoogleIcon.jsx';

const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;

// Suggests a public username from the full name, e.g. "Ada Okafor" -> "ada-okafor".
function suggestUsernameFrom(fullName) {
  const base = fullName.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return base.length >= 3 ? base : '';
}

function getPasswordStrength(password) {
  let score = 0;
  if (!password) return { score: 0, label: 'No password', color: '#94A3B8' };
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) return { score: 1, label: 'Weak', color: '#EF4444' };
  if (score === 2) return { score: 2, label: 'Fair', color: '#F59E0B' };
  if (score === 3) return { score: 3, label: 'Good', color: '#3B82F6' };
  return { score: 4, label: 'Strong', color: '#16A34A' };
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', username: '', password: '', confirmPassword: '' });
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [usernameState, setUsernameState] = useState({ status: 'idle', message: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);

  const strength = useMemo(() => getPasswordStrength(form.password), [form.password]);

  // Until the user edits it, the username follows their name, so signup needs no extra step.
  const suggested = suggestUsernameFrom(form.fullName);
  const username = usernameEdited ? form.username.trim().toLowerCase() : suggested;

  useEffect(() => {
    if (!username) {
      setUsernameState({ status: 'idle', message: '' });
      return undefined;
    }
    if (!USERNAME_RE.test(username)) {
      setUsernameState({ status: 'invalid', message: 'Use 3–48 letters, numbers or hyphens. No hyphen at the start or end.' });
      return undefined;
    }
    setUsernameState({ status: 'checking', message: 'Checking availability…' });
    let active = true;
    const timer = window.setTimeout(() => {
      checkUsername(username)
        .then(({ data }) => {
          if (!active) return;
          setUsernameState(data.available
            ? { status: 'available', message: 'Available' }
            : { status: 'taken', message: data.reason || 'That username is taken.' });
        })
        .catch(() => { if (active) setUsernameState({ status: 'idle', message: '' }); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [username]);

  const updateField = (event) => {
    const { name, value } = event.target;
    if (name === 'username') setUsernameEdited(true);
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setNotice(null);

    if (!form.fullName.trim() || !form.email.trim() || !form.phone.trim()) {
      setNotice({ type: 'error', text: 'Please complete all fields.' });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setNotice({ type: 'error', text: 'Please enter a valid email address.' });
      return;
    }

    if (!isValidNigerianPhone(form.phone)) {
      setNotice({ type: 'error', text: 'Please enter a valid Nigerian phone number.' });
      return;
    }

    if (usernameState.status === 'taken' || usernameState.status === 'invalid') {
      setNotice({ type: 'error', text: usernameState.message || 'Please choose a different username.' });
      return;
    }

    if (form.password.length < 8) {
      setNotice({ type: 'error', text: 'Password must be at least 8 characters.' });
      return;
    }

    if (form.password !== form.confirmPassword) {
      setNotice({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    try {
      setLoading(true);
      await register({
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        username,
        password: form.password,
        confirmPassword: form.confirmPassword,
      });
      navigate('/dashboard');
    } catch (error) {
      const responseMessage = error.response?.data?.message;
      const networkMessage = error.code === 'ECONNABORTED'
        ? 'The registration request timed out. Check your connection and try again.'
        : !error.response
          ? 'Could not reach the Jimvolt server. Check that the backend is running and try again.'
          : null;
      setNotice({
        type: 'error',
        text: responseMessage || networkMessage || 'Registration failed. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card-wide">
        <Link to="/" className="auth-logo" aria-label="Jimvolt home"><img className="brand-logo auth-brand-image" src="/jimvolt-logo.png" alt="Jimvolt" /></Link>
        <div className="auth-header">
          <div className="auth-badge"><ShieldCheck size={22} /></div>
          <div>
            <p className="eyebrow">Create account</p>
            <h1>Start selling with Jimvolt</h1>
          </div>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="field-grid">
            <label className="field">
              <span>Full name</span>
              <input name="fullName" value={form.fullName} onChange={updateField} placeholder="Ada Okafor" />
            </label>
            <label className="field">
              <span>Email address</span>
              <input type="email" name="email" value={form.email} onChange={updateField} placeholder="you@example.com" />
            </label>
            <label className="field">
              <span>Phone number</span>
              <input name="phone" value={form.phone} onChange={updateField} placeholder="0803 123 4567" />
            </label>

            <label className="field field-wide">
              <span>Your profile link</span>
              <input
                name="username"
                value={usernameEdited ? form.username : username}
                onChange={updateField}
                placeholder="your-name"
                autoComplete="off"
                aria-describedby="username-help"
              />
              <small id="username-help" className={`username-help username-${usernameState.status}`} aria-live="polite">
                {username
                  ? `jimvolt.com/@${username}${usernameState.message ? ` · ${usernameState.message}` : ''}`
                  : 'Enter your name above, or type a username you like.'}
              </small>
            </label>

            <label className="field field-password">
              <span>Password</span>
              <div className="password-wrap">
                <input type={showPassword ? 'text' : 'password'} name="password" value={form.password} onChange={updateField} placeholder="Minimum 8 characters" />
                <button type="button" className="icon-btn" onClick={() => setShowPassword((current) => !current)} aria-label="Toggle password visibility">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <label className="field field-password">
              <span>Confirm password</span>
              <div className="password-wrap">
                <input type={showConfirmPassword ? 'text' : 'password'} name="confirmPassword" value={form.confirmPassword} onChange={updateField} placeholder="Re-enter password" />
                <button type="button" className="icon-btn" onClick={() => setShowConfirmPassword((current) => !current)} aria-label="Toggle password visibility">
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
          </div>

          {form.password && (
            <div className="strength-box" aria-live="polite">
              <div className="strength-bar">
                <span style={{ width: `${(strength.score / 4) * 100}%`, background: strength.color }} />
              </div>
              <div className="strength-copy">
                <strong>Password strength:</strong> {strength.label}
                {strength.score >= 3 && <CheckCircle2 size={16} className="ok" />}
              </div>
            </div>
          )}

          {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}

          <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
            {loading ? <><LoaderCircle size={16} className="spin" /> Creating account...</> : 'Create my account'}
          </button>
        </form>

        <div className="auth-divider"><span>or</span></div>
        <a className="btn btn-white auth-google" href={GOOGLE_SIGN_IN_URL}>
          <GoogleIcon /> Sign up with Google
        </a>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
