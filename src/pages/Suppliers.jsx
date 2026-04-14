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

export default function Suppliers() {
  const { user } = useAuth();
  const canManage = ['Manager', 'Executive'].includes(user?.role);

  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [search, setSearch]         = useState('');
  const [blacklistOnly, setBlacklist] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [blacklistTarget, setBlacklistTarget] = useState(null);
  const [form, setForm]             = useState({ name: '', registration_number: '', contact_email: '', contact_phone: '', document_expiry: '' });
  const [formError, setFormError]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [blacklistReason, setBlacklistReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 50 });
      if (search) params.set('search', search);
      if (blacklistOnly) params.set('blacklisted', 'true');
      const data = await api.get(`/api/suppliers?${params}`);
      setItems(data.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [search, blacklistOnly]);

  useEffect(() => { load(); }, [load]);

  async function createSupplier(e) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await api.post('/api/suppliers', {
        name: form.name,
        registration_number: form.registration_number || undefined,
        contact_email: form.contact_email || undefined,
        contact_phone: form.contact_phone || undefined,
        document_expiry: form.document_expiry || undefined,
      });
      setShowCreate(false);
      setForm({ name: '', registration_number: '', contact_email: '', contact_phone: '', document_expiry: '' });
      load();
    } catch (e) { setFormError(e.message); }
    finally { setSubmitting(false); }
  }

  async function doBlacklist() {
    if (!blacklistReason.trim()) return;
    setSubmitting(true);
    try {
      await api.patch(`/api/suppliers/${blacklistTarget.id}/blacklist`, { reason: blacklistReason });
      setBlacklistTarget(null);
      setBlacklistReason('');
      load();
    } catch (e) { alert(e.message); }
    finally { setSubmitting(false); }
  }

  async function liftBlacklist(id) {
    if (!confirm('Lift blacklist on this supplier?')) return;
    try {
      await api.delete(`/api/suppliers/${id}/blacklist`);
      load();
    } catch (e) { alert(e.message); }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const scoreColor = s => s >= 80 ? '#10b981' : s >= 50 ? '#f59e0b' : '#f43f5e';
  const expiryWarn = d => d && new Date(d) < new Date(Date.now() + 30 * 864e5);

  return (
    <div className="animate-fade-in">
      <div className="topbar">
        <div className="header-title">
          <h1>Supplier Registry</h1>
          <p>Vet suppliers, track compliance scores and document expiry.</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Add Supplier</button>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <input
          className="search-input"
          placeholder="Search by name or registration…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: 360 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem' }}>
          <input type="checkbox" checked={blacklistOnly} onChange={e => setBlacklist(e.target.checked)} />
          Blacklisted only
        </label>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        {loading ? (
          <div className="page-loading"><div className="spinner" /></div>
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: 40 }}>🤝</span>
            <p>No suppliers found</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Contact</th>
                <th>Compliance Score</th>
                <th>Doc Expiry</th>
                <th>Status</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(s => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    {s.registration_number && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{s.registration_number}</div>
                    )}
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <div>{s.contact_email || '—'}</div>
                    <div>{s.contact_phone || ''}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3 }}>
                        <div style={{ width: `${s.compliance_score}%`, height: '100%', background: scoreColor(s.compliance_score), borderRadius: 3, transition: 'width 0.4s' }} />
                      </div>
                      <span style={{ fontWeight: 600, color: scoreColor(s.compliance_score), minWidth: 32, fontSize: '0.85rem' }}>
                        {s.compliance_score}
                      </span>
                    </div>
                  </td>
                  <td style={{ fontSize: '0.85rem', color: expiryWarn(s.document_expiry) ? '#f43f5e' : 'var(--text-secondary)' }}>
                    {s.document_expiry ? (
                      <>
                        {expiryWarn(s.document_expiry) && '⚠️ '}
                        {new Date(s.document_expiry).toLocaleDateString()}
                      </>
                    ) : '—'}
                  </td>
                  <td>
                    {s.is_blacklisted ? (
                      <span className="status-badge status-disputed">Blacklisted</span>
                    ) : (
                      <span className="status-badge status-paid">Active</span>
                    )}
                  </td>
                  {canManage && (
                    <td>
                      {s.is_blacklisted ? (
                        user?.role === 'Executive' && (
                          <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', color: '#10b981' }}
                            onClick={() => liftBlacklist(s.id)}>
                            Lift Ban
                          </button>
                        )
                      ) : (
                        <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', color: '#f43f5e', borderColor: 'rgba(244,63,94,0.3)' }}
                          onClick={() => setBlacklistTarget(s)}>
                          Blacklist
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

      {/* Create modal */}
      {showCreate && (
        <Modal title="Add Supplier" onClose={() => setShowCreate(false)}>
          <form onSubmit={createSupplier} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label>Company Name *</label>
              <input value={form.name} onChange={set('name')} required placeholder="Supplier Ltd." />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Registration No.</label>
                <input value={form.registration_number} onChange={set('registration_number')} placeholder="e.g. 120045678" />
              </div>
              <div className="form-group">
                <label>Document Expiry</label>
                <input type="date" value={form.document_expiry} onChange={set('document_expiry')} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Contact Email</label>
                <input type="email" value={form.contact_email} onChange={set('contact_email')} placeholder="accounts@supplier.com" />
              </div>
              <div className="form-group">
                <label>Contact Phone</label>
                <input value={form.contact_phone} onChange={set('contact_phone')} placeholder="+260 97 1234567" />
              </div>
            </div>
            {formError && <div className="alert alert-error">{formError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Add Supplier'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Blacklist confirm modal */}
      {blacklistTarget && (
        <Modal title={`Blacklist — ${blacklistTarget.name}`} onClose={() => setBlacklistTarget(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="alert alert-warn">
              This supplier will be blocked from all future engagements. All officers will be notified.
            </div>
            <div className="form-group">
              <label>Reason *</label>
              <textarea rows={3} value={blacklistReason} onChange={e => setBlacklistReason(e.target.value)}
                placeholder="State the grounds for blacklisting…" required />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setBlacklistTarget(null)}>Cancel</button>
              <button className="btn-primary" style={{ background: '#f43f5e' }} disabled={submitting || !blacklistReason.trim()}
                onClick={doBlacklist}>
                {submitting ? 'Blacklisting…' : 'Confirm Blacklist'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
