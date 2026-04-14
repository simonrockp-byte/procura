import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function AcceptInvite() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (t) setToken(t);
    else setError('Missing invitation token.');
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');

    setLoading(true);
    try {
      await api.post('/api/auth/accept-invite', { token, password });
      setSuccess(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="login-container">
        <div className="login-box glass-panel animate-fade-in" style={{ textAlign: 'center' }}>
          <div className="login-header">
            <span style={{ fontSize: 40 }}>✅</span>
            <h1>Account Activated</h1>
            <p>Your password has been set. You can now log in to the Procura platform.</p>
          </div>
          <button className="btn-primary" style={{ width: '100%' }} onClick={() => window.location.href = '/'}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-box glass-panel animate-fade-in">
        <div className="login-header">
          <div className="logo-icon"></div>
          <h1>Join Procura</h1>
          <p>Complete your registration by setting a secure password.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>New Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              required 
            />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input 
              type="password" 
              value={confirm} 
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              required 
            />
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading || !!error && !token}>
            {loading ? 'Activating...' : 'Set Password & Activate'}
          </button>
        </form>
      </div>
    </div>
  );
}
