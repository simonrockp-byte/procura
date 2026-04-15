import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ org_slug: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.org_slug, form.email, form.password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f1f5f9' }}>

      {/* ── Left: Brand Panel ── */}
      <div style={{
        width: 480,
        flexShrink: 0,
        background: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '3rem',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Subtle glow */}
        <div style={{
          position: 'absolute', top: '-20%', right: '-20%',
          width: '70%', height: '70%',
          background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', left: '-20%',
          width: '60%', height: '60%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: '#f59e0b',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 20, color: '#000',
          }}>P</div>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '0.08em', color: '#f8fafc' }}>
            PROCURA
          </span>
        </div>

        {/* Hero copy */}
        <div style={{ position: 'relative' }}>
          <h2 style={{
            fontSize: '2.75rem', fontWeight: 800, lineHeight: 1.1,
            color: '#f8fafc', marginBottom: '1.25rem', letterSpacing: '-0.03em',
          }}>
            Precision<br />
            <span style={{ color: '#f59e0b' }}>Procurement</span><br />
            Tracking.
          </h2>
          <p style={{ fontSize: '0.95rem', color: '#94a3b8', lineHeight: 1.7, maxWidth: 320 }}>
            From requisition to delivery confirmation — maintain a 100% compliant, immutable audit trail.
          </p>
          <div style={{ display: 'flex', gap: '2rem', marginTop: '2.5rem' }}>
            {[['100%', 'Compliant'], ['Immutable', 'Audit Logs'], ['72h', 'SLA Tracked']].map(([val, label]) => (
              <div key={label}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>{val}</div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Dot grid decoration */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          pointerEvents: 'none',
        }} />

        <p style={{ fontSize: '0.75rem', color: '#334155', position: 'relative' }}>
          CODX Systems Tech · Enterprise Security Enabled
        </p>
      </div>

      {/* ── Right: Form Panel ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}>
        <div className="animate-fade-in" style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ marginBottom: '2.5rem' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
              Sign in
            </h1>
            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
              Enter your organisation ID and credentials to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <label>Organisation ID</label>
              <input
                type="text"
                placeholder="e.g. codx-systems"
                value={form.org_slug}
                onChange={set('org_slug')}
                required
                autoComplete="organization"
              />
            </div>

            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="you@organisation.com"
                value={form.email}
                onChange={set('email')}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={set('password')}
                required
                autoComplete="current-password"
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '0.875rem', fontSize: '0.95rem', marginTop: '0.25rem', justifyContent: 'center' }}
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign In to Dashboard'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '2rem', color: '#94a3b8', fontSize: '0.75rem' }}>
            Don't have access? Contact your organisation administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
