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

export default function Deliveries() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [orderedReqs, setOrderedReqs] = useState([]);
  const [selected, setSelected] = useState(null);

  // Form state
  const [form, setForm] = useState({ requisition_id: '', notes: '', photo: null });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/deliveries');
      setItems(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (showCreate) {
      api.get('/api/requisitions?status=Ordered&limit=100').then(d => setOrderedReqs(d.data || [])).catch(() => {});
    }
  }, [showCreate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('requisition_id', form.requisition_id);
      formData.append('notes', form.notes);
      if (form.photo) formData.append('photo', form.photo);

      // Try to get geolocation
      if (navigator.geolocation) {
        const pos = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 5000 });
        });
        if (pos) {
          formData.append('gps_lat', pos.coords.latitude);
          formData.append('gps_lng', pos.coords.longitude);
        }
      }

      await api.upload('/api/deliveries', formData);
      setShowCreate(false);
      setForm({ requisition_id: '', notes: '', photo: null });
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="topbar">
        <div className="header-title">
          <h1>Deliveries</h1>
          <p>Verify and confirm receipt of goods or services.</p>
        </div>
        {user?.role === 'Officer' && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>Confirm Delivery</button>
        )}
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        {loading ? (
          <div className="page-loading"><div className="spinner" /></div>
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: 40 }}>📦</span>
            <p>No deliveries recorded yet</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Requisition</th>
                <th>Supplier</th>
                <th>Confirmed By</th>
                <th>Date</th>
                <th>Location</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map(d => (
                <tr key={d.id} onClick={() => setSelected(d)} className="table-row-clickable">
                  <td>
                    <div style={{ fontWeight: 600 }}>{d.requisition_ref}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{d.requisition_title}</div>
                  </td>
                  <td>{d.supplier_name}</td>
                  <td>{d.confirmed_by_name}</td>
                  <td>{new Date(d.created_at).toLocaleDateString()}</td>
                  <td style={{ fontSize: '0.8rem' }}>
                    {d.gps_lat ? `${d.gps_lat.toFixed(4)}, ${d.gps_lng.toFixed(4)}` : 'N/A'}
                  </td>
                  <td className="text-truncate" style={{ maxWidth: 200 }}>{d.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <Modal title="Confirm Delivery" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label>Reference Requisition *</label>
              <select 
                value={form.requisition_id} 
                onChange={e => setForm(f => ({ ...f, requisition_id: e.target.value }))}
                required
              >
                <option value="">— Select an ordered requisition —</option>
                {orderedReqs.map(r => (
                  <option key={r.id} value={r.id}>{r.ref_number} — {r.title}</option>
                ))}
              </select>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                Only requisitions in 'Ordered' status are listed.
              </p>
            </div>

            <div className="form-group">
              <label>Delivery Photo (required)</label>
              <input 
                type="file" 
                accept="image/*" 
                onChange={e => setForm(f => ({ ...f, photo: e.target.files[0] }))}
                required
              />
            </div>

            <div className="form-group">
              <label>Notes</label>
              <textarea 
                value={form.notes} 
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3} 
                placeholder="e.g. Quantity verified, package condition..."
              />
            </div>

            {formError && <div className="alert alert-error">{formError}</div>}
            
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary" style={{ flex: 1 }} disabled={submitting}>
                {submitting ? 'Confirming...' : 'Confirm Delivery'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {selected && (
        <Modal title={`Delivery — ${selected.requisition_ref}`} onClose={() => setSelected(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {selected.photo_url && (
              <div style={{ width: '100%', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
                <img src={selected.photo_url} alt="Delivery" style={{ width: '100%', display: 'block' }} />
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {[
                ['Requisition', selected.requisition_title],
                ['Supplier', selected.supplier_name],
                ['Confirmed By', selected.confirmed_by_name],
                ['Date', new Date(selected.created_at).toLocaleString()],
                ['Location', selected.gps_lat ? `${selected.gps_lat}, ${selected.gps_lng}` : 'Not recorded'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{k}</div>
                  <div style={{ fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
            {selected.notes && (
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Notes</div>
                <p style={{ margin: 0 }}>{selected.notes}</p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
