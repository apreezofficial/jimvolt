import { useEffect, useRef, useState } from 'react';
import api from '../services/api.js';
import { GOOGLE_SIGN_IN_URL } from '../services/googleAuth.js';
import GoogleIcon from './GoogleIcon.jsx';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

let scriptPromise = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('Could not load Google sign-in.'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

// Google's popup sign-in button. Falls back to the server redirect flow when
// VITE_GOOGLE_CLIENT_ID is not set or Google's script cannot load.
export default function GoogleSignInButton({ text = 'continue_with', onError, fallbackLabel = 'Continue with Google' }) {
  const containerRef = useRef(null);
  const [useFallback, setUseFallback] = useState(!GOOGLE_CLIENT_ID);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return undefined;
    let cancelled = false;

    const handleCredential = async ({ credential }) => {
      try {
        const { data } = await api.post('/auth/google/credential', { credential });
        const storage = window.localStorage;
        storage.setItem('jimvolt_token', data.token);
        storage.setItem('jimvolt_user', JSON.stringify(data.user));
        sessionStorage.removeItem('jimvolt_token');
        sessionStorage.removeItem('jimvolt_user');
        window.location.replace('/dashboard');
      } catch (error) {
        onError?.(error.response?.data?.message || 'Google sign-in failed. Please try again.');
      }
    };

    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredential,
          ux_mode: 'popup',
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          width: containerRef.current.offsetWidth || 360,
        });
      })
      .catch(() => {
        if (!cancelled) setUseFallback(true);
      });

    return () => { cancelled = true; };
    // handleCredential captures onError; the button only needs to render once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  if (useFallback) {
    return (
      <a className="btn btn-white auth-google" href={GOOGLE_SIGN_IN_URL}>
        <GoogleIcon /> {fallbackLabel}
      </a>
    );
  }

  return <div ref={containerRef} className="google-signin-slot" aria-label={fallbackLabel} />;
}
