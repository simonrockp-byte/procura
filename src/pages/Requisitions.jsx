import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const STATUSES = ['Draft', 'Approved', 'Ordered', 'Delivered', 'Paid', 'Disputed'];

const TRANSITIONS = {
  Officer:   { Draft: [], Approved: [], Ordered: ['Delivered'], Delivered: [], Paid: [], Disputed: [] },
  Manager:   { Draft: ['Approved'], Approved: ['Ordered', 'Disputed'], Ordered: ['Disputed'], Delivered: ['Disputed'], Paid: [], Disputed: ['Approved'] },
  Executive: { Draft: ['Approved'], Approved: ['Ordered', 'Disputed'], Ordered: ['Disputed'], Delivered: ['Disputed'], Paid: [], Disputed: ['Approved'] },
  Auditor:   {},
};

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

export default function Requisitions() {
  const { user } = useAuth();
  const [items, setItems]         = useState([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [filter, setFilter]       = useState('all');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected]   = useState(null);
  const [suppliers, setSuppliers] = useState([]);

  // Create form state
  const [form, setForm] = useState({ title: '', description: '', amount: '', currency: 'ZMW', supplier_id: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 15 });
      if (filter !== 'all') params.set('status', filter);
      const data = await api.get(`/api/requisitions?${params}`);
      setItems(data.data);
      setTotal(data.pagination.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/api/suppliers?limit=100').then(d => setSuppliers(d.data || [])).catch(() => {});
  }, []);

  async function createReq(e) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await api.post('/api/requisitions', {
        title: form.title,
        description: form.description || undefined,
        amount: parseFloat(form.amount),
        currency: form.currency,
        supplier_id: form.supplier_id || undefined,
      });
      setShowCreate(false);
      setForm({ title: '', description: '', amount: '', currency: 'ZMW', supplier_id: '' });
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(id, status) {
    try {
      const updated = await api.patch(`/api/requisitions/${id}/status`, { status });
      setItems(prev => prev.map(r => r.id === id ? updated : r));
      if (selected?.id === id) setSelected(updated);
    } catch (e) {
      alert(e.message);
    }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const pages = Math.ceil(total / 15);
  const allowedTransitions = user?.role ? (TRANSITIONS[user.role] || {}) : {};

  return (
    <div className="animate-fade-in">
      <div className="topbar">
        <div className="header-title">
          <h1>Requisitions</h1>
          <p>Track every purchase from creation to payment.</p>
        </div>
        {user?.role !== 'Auditor' && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Requisition</button>
        )}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {['all', ...STATUSES].map(s => (
          <button
            key={s}
            className={`btn-ghost${filter === s ? ' active' : ''}`}
            style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}
            onClick={() => { setFilter(s); setPage(1); }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        {loading ? (
          <div className="page-loading"><div className="spinner" /></div>
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: 40 }}>📋</span>
            <p>No requisitions found</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Ref &amp; Title</th>
                <th>Amount</th>
                <th>Supplier</th>
                <th>Raised By</th>
                <th>Status</th>
                <th>SLA</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => {
                const overdue = r.status === 'Ordered' && r.sla_deadline && new Date(r.sla_deadline) < new Date();
                return (
                  <tr key={r.id} onClick={() => setSelected(r)} className="table-row-clickable">
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.title}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{r.ref_number}</div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{r.currency} {Number(r.amount).toLocaleString()}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{r.supplier_name || '—'}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{r.created_by_name}</td>
                    <td><span className={`status-badge status-${r.status.toLowerCase()}`}>{r.status}</span></td>
                    <td style={{ fontSize: '0.8rem', color: overdue ? '#f43f5e' : 'var(--text-secondary)' }}>
                      {r.sla_deadline ? (overdue ? '⚠️ Overdue' : new Date(r.sla_deadline).toLocaleDateString()) : '—'}
                    </td>
                    <td>
                      {(allowedTransitions[r.status] || []).map(ns => (
                        <button
                          key={ns}
                          className="btn-ghost"
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', marginRight: 4 }}
                          onClick={e => { e.stopPropagation(); updateStatus(r.id, ns); }}
                        >
                          → {ns}
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
            <button className="btn-ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)}
              style={{ padding: '0.4rem 0.75rem' }}>← Prev</button>
            <span style={{ padding: '0.4rem 0.75rem', color: 'var(--text-secondary)' }}>
              Page {page} of {pages}
            </span>
            <button className="btn-ghost" disabled={page === pages} onClick={() => setPage(p => p + 1)}
              style={{ padding: '0.4rem 0.75rem' }}>Next →</button>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Requisition" onClose={() => setShowCreate(false)}>
          <form onSubmit={createReq} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label>Title *</label>
              <input value={form.title} onChange={set('title')} required placeholder="What are you procuring?" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={set('description')} rows={3} placeholder="Additional details…" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Amount *</label>
                <input type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required placeholder="0.00" />
              </div>
              <div className="form-group">
                <label>Currency</label>
                <select value={form.currency} onChange={set('currency')}>
                  <option>ZMW</option><option>USD</option><option>ZAR</option><option>EUR</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Supplier (optional)</label>
              <select value={form.supplier_id} onChange={set('supplier_id')}>
                <option value="">— Select supplier —</option>
                {suppliers.filter(s => !s.is_blacklisted).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {formError && <div className="alert alert-error">{formError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Requisition'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Detail drawer */}
      {selected && (
        <Modal title={`${selected.ref_number} — ${selected.title}`} onClose={() => setSelected(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {[
                ['Status', <span className={`status-badge status-${selected.status.toLowerCase()}`}>{selected.status}</span>],
                ['Amount', `${selected.currency} ${Number(selected.amount).toLocaleString()}`],
                ['Supplier', selected.supplier_name || '—'],
                ['Raised By', selected.created_by_name],
                ['Approved By', selected.approved_by_name || '—'],
                ['SLA Deadline', selected.sla_deadline ? new Date(selected.sla_deadline).toLocaleString() : '—'],
                ['Created', new Date(selected.created_at).toLocaleString()],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
            {selected.description && (
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: 4 }}>Description</div>
                <p style={{ margin: 0 }}>{selected.description}</p>
              </div>
            )}
            {(allowedTransitions[selected.status] || []).length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--glass-border)' }}>
                {(allowedTransitions[selected.status] || []).map(ns => (
                  <button key={ns} className="btn-primary" style={{ fontSize: '0.85rem' }}
                    onClick={() => updateStatus(selected.id, ns)}>
                    Mark as {ns}
                  </button>
                ))}
              </div>
            )}
            {user?.role === 'Executive' && (
              <button 
                className="btn-ghost" 
                style={{ marginTop: '0.5rem', width: '100%', borderColor: 'var(--accent-color)', color: 'var(--accent-color)' }}
                onClick={async () => {
                  try {
                    const report = await api.get(`/api/reports/incident/${selected.id}`);
                    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `incident-report-${selected.ref_number}.json`;
                    a.click();
                  } catch (e) { alert(e.message); }
                }}
              >
                📄 Generate Incident Report (JSON)
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
