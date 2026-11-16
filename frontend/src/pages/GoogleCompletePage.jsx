import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Landing page after Google sign-in. The backend passes the session token in the
// URL fragment; it is stored like a normal login, then removed from the address bar.
export default function GoogleCompletePage() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      setFailed(true);
      navigate('/login?oauth_error=google_failed', { replace: true });
      return;
    }

    try {
      localStorage.setItem('jimvolt_token', token);
      localStorage.removeItem('jimvolt_user');
      sessionStorage.removeItem('jimvolt_token');
      sessionStorage.removeItem('jimvolt_user');
    } catch {
      navigate('/login?oauth_error=google_failed', { replace: true });
      return;
    }
    // A full load lets the auth provider read the stored token on startup.
    window.location.replace('/dashboard');
  }, [navigate]);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <p className="auth-footer">
          {failed ? 'Sign-in failed. Redirecting…' : (
            <><LoaderCircle size={16} className="spin" /> Signing you in…</>
          )}
        </p>
      </div>
    </div>
  );
}
