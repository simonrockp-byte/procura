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
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-color)' }}>
      {/* --- Left Side: Login Form --- */}
      <div style={{ 
        flex: '1', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '2rem',
        zIndex: 1
      }}>
        <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: 420, padding: '3rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <div style={{ 
              width: 72, 
              height: 72, 
              margin: '0 auto 1.25rem',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 8px 16px var(--accent-glow)',
              background: '#020617'
            }}>
              <img 
                src="/procura-logo.png" 
                alt="Procura Logo" 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
              />
            </div>
            <h1 className="text-gradient" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>PROCURA</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Procurement Compliance Platform</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="form-group">
              <label>Organisation ID</label>
              <input
                type="text"
                placeholder="e.g. codx-systems"
                value={form.org_slug}
                onChange={set('org_slug')}
                required
              />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="officer@organisation.com"
                value={form.email}
                onChange={set('email')}
                required
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
              />
            </div>

            {error && (
              <div className="alert alert-error">{error}</div>
            )}

            <button type="submit" className="btn-primary" style={{ marginTop: '0.5rem', padding: '1rem', fontSize: '1rem' }} disabled={loading}>
              {loading ? 'Authenticating…' : 'Sign In to Dashboard'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '2.5rem', color: 'var(--text-secondary)', fontSize: '0.8rem', opacity: 0.6 }}>
            CODX Systems Tech — Enterprise Security Enabled
          </p>
        </div>
      </div>

      {/* --- Right Side: Hero Visual --- */}
      <div className="hero-section" style={{ 
        flex: '1.2', 
        background: 'linear-gradient(135deg, #0f172a 0%, #020617 100%)',
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderLeft: '1px solid var(--glass-border)'
      }}>
        {/* Dynamic Background Blurs */}
        <div style={{ 
          position: 'absolute', 
          top: '20%', 
          left: '20%', 
          width: '60%', 
          height: '60%', 
          background: 'radial-gradient(circle, var(--accent-glow) 0%, transparent 70%)',
          filter: 'blur(60px)',
          opacity: 0.4
        }} />
        
        <div style={{ position: 'relative', zIndex: 2, padding: '4rem', maxWidth: 600 }}>
          <h2 style={{ fontSize: '3.5rem', lineHeight: 1.1, marginBottom: '2rem' }}>
            Precision <span className="text-gradient">Procurement</span> Tracking.
          </h2>
          <p style={{ fontSize: '1.25rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '3rem' }}>
            From requisition to delivery confirmation, maintain a 100% compliant audit trail with the industry's most robust SaaS platform.
          </p>
          
          <div style={{ display: 'flex', gap: '2rem' }}>
            <div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#fff' }}>100%</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Compliant</div>
            </div>
            <div style={{ width: 1, height: 40, background: 'var(--glass-border)' }} />
            <div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#fff' }}>Immutable</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Audit Logs</div>
            </div>
          </div>
        </div>

        {/* Decorative Grid */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: 'radial-gradient(var(--glass-border) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          opacity: 0.2
        }} />
      </div>

      {/* Media Query simulation for the hero section */}
      <style>{`
        @media (max-width: 1024px) {
          .hero-section { display: none !important; }
        }
        @media (min-width: 1025px) {
          .hero-section { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
