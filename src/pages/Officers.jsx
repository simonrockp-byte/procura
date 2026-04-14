import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal glass-panel">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Officers() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);

  // Invite form
  const [form, setForm] = useState({ email: '', full_name: '', role: 'Officer', phone_number: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/officers');
      setItems(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleInvite(e) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await api.post('/api/auth/invite', form);
      setShowInvite(false);
      setForm({ email: '', full_name: '', role: 'Officer', phone_number: '' });
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(officer) {
    if (officer.id === user?.id) return alert("You cannot deactivate yourself.");
    try {
      const updated = await api.patch(`/api/officers/${officer.id}`, { is_active: !officer.is_active });
      setItems(prev => prev.map(o => o.id === officer.id ? { ...o, is_active: updated.is_active } : o));
    } catch (e) {
      alert(e.message);
    }
  }

  async function changeRole(officer, role) {
    try {
      const updated = await api.patch(`/api/officers/${officer.id}`, { role });
      setItems(prev => prev.map(o => o.id === officer.id ? { ...o, role: updated.role } : o));
    } catch (e) {
      alert(e.message);
    }
  }

  const isExecutive = user?.role === 'Executive';
  const canInvite = ['Manager', 'Executive'].includes(user?.role);

  return (
    <div className="animate-fade-in">
      <div className="topbar">
        <div className="header-title">
          <h1>Officers</h1>
          <p>Manage access and roles for your organisation.</p>
        </div>
        {canInvite && (
          <button className="btn-primary" onClick={() => setShowInvite(true)}>+ Invite Officer</button>
        )}
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        {loading ? (
          <div className="page-loading"><div className="spinner" /></div>
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Role</th>
                <th>Contact</th>
                <th>Status</th>
                {isExecutive && <th style={{ textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(o => (
                <tr key={o.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{o.full_name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{o.email}</div>
                  </td>
                  <td>
                    {isExecutive && o.id !== user?.id ? (
                      <select 
                        value={o.role} 
                        onChange={e => changeRole(o, e.target.value)}
                        style={{ background: 'transparent', color: '#fff', border: '1px solid var(--glass-border)', borderRadius: 4, padding: '2px 4px' }}
                      >
                        {['Officer', 'Manager', 'Executive', 'Auditor'].map(r => (
                          <option key={r} value={r} style={{ background: '#0f172a' }}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="status-badge" style={{ background: 'rgba(255,255,255,0.05)' }}>{o.role}</span>
                    )}
                  </td>
                  <td>
                    <div style={{ fontSize: '0.85rem' }}>{o.phone_number || 'No phone'}</div>
                  </td>
                  <td>
                    <span className={`status-badge ${o.is_active ? 'status-paid' : 'status-disputed'}`}>
                      {o.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  {isExecutive && (
                    <td style={{ textAlign: 'right' }}>
                      {o.id !== user?.id && (
                        <button 
                          className={`btn-ghost`} 
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', borderColor: o.is_active ? '#f43f5e' : '#10b981', color: o.is_active ? '#f43f5e' : '#10b981' }}
                          onClick={() => toggleActive(o)}
                        >
                          {o.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showInvite && (
        <Modal title="Invite New Officer" onClose={() => setShowInvite(false)}>
          <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label>Full Name *</label>
              <input 
                value={form.full_name} 
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                required 
                placeholder="John Doe"
              />
            </div>
            <div className="form-group">
              <label>Email Address *</label>
              <input 
                type="email" 
                value={form.email} 
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required 
                placeholder="john@example.com"
              />
            </div>
            <div className="form-group">
              <label>WhatsApp Number (E.164)</label>
              <input 
                value={form.phone_number} 
                onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
                placeholder="+260..."
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                Include country code. Used for procurement updates via WhatsApp.
              </p>
            </div>
            <div className="form-group">
              <label>Role *</label>
              <select 
                value={form.role} 
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                required
              >
                <option value="Officer">Officer</option>
                <option value="Manager">Manager</option>
                <option value="Executive">Executive</option>
                <option value="Auditor">Auditor</option>
              </select>
            </div>
            {formError && <div className="alert alert-error">{formError}</div>}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowInvite(false)}>Cancel</button>
              <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={submitting}>
                {submitting ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
