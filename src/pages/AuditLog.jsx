import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

const ACTION_COLOR = { INSERT: '#10b981', UPDATE: '#3b82f6', DELETE: '#f43f5e', SYSTEM: '#8b5cf6' };
const TABLES = ['requisitions', 'suppliers', 'deliveries', 'payments', 'officers', 'escalations', 'organisations'];

export default function AuditLog() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [page, setPage]       = useState(1);
  const [tableFilter, setTableFilter] = useState('');
  const [verifying, setVerifying]     = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 30 });
      if (tableFilter) params.set('table', tableFilter);
      const data = await api.get(`/api/dashboard/audit/log?${params}`);
      setRows(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [page, tableFilter]);

  useEffect(() => { load(); }, [load]);

  async function verifyChain() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.get('/api/dashboard/audit/verify');
      setVerifyResult(result);
    } catch (e) { setVerifyResult({ valid: false, error: e.message }); }
    finally { setVerifying(false); }
  }

  return (
    <div className="animate-fade-in">
      <div className="topbar">
        <div className="header-title">
          <h1>Audit Log</h1>
          <p>Append-only, SHA-256 hash-chained record of every action in the system.</p>
        </div>
        <button className="btn-ghost" onClick={verifyChain} disabled={verifying}
          style={{ borderColor: verifyResult?.valid === false ? 'rgba(244,63,94,0.5)' : undefined }}>
          {verifying ? 'Verifying…' : '🔐 Verify Chain'}
        </button>
      </div>

      {verifyResult && (
        <div className={`alert ${verifyResult.valid ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '1.5rem' }}>
          {verifyResult.valid
            ? '✅ Hash chain is intact — no tampering detected'
            : `🚨 Chain broken at entry #${verifyResult.brokenAt ?? '?'} — audit log may have been tampered with`}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="search-input"
          value={tableFilter}
          onChange={e => { setTableFilter(e.target.value); setPage(1); }}
          style={{ maxWidth: 220 }}
        >
          <option value="">All tables</option>
          {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn-ghost" onClick={() => { setPage(1); load(); }} style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}>
          ↻ Refresh
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '0' }}>
        {loading ? (
          <div className="page-loading"><div className="spinner" /></div>
        ) : error ? (
          <div className="alert alert-error" style={{ margin: '2rem' }}>{error}</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: 40 }}>📋</span>
            <p>No audit entries found</p>
          </div>
        ) : (
          rows.map((row, i) => (
            <div key={row.id}>
              <div
                style={{
                  padding: '1rem 1.5rem',
                  borderBottom: i < rows.length - 1 ? '1px solid var(--glass-border)' : 'none',
                  display: 'flex', alignItems: 'flex-start', gap: '1rem', cursor: 'pointer',
                }}
                onClick={() => setExpanded(expanded === row.id ? null : row.id)}
              >
                {/* Action badge */}
                <div style={{
                  padding: '0.2rem 0.6rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700,
                  background: `${ACTION_COLOR[row.action]}20`, color: ACTION_COLOR[row.action],
                  minWidth: 60, textAlign: 'center', marginTop: 2, flexShrink: 0,
                }}>
                  {row.action}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{row.table_name}</span>
                    {row.record_id && (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>
                        {row.record_id.slice(0, 8)}…
                      </span>
                    )}
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      by <strong>{row.actor_name || 'system'}</strong>
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {new Date(row.created_at).toLocaleString()} · #{row.id}
                  </div>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {expanded === row.id ? '▲' : '▼'}
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === row.id && (
                <div style={{
                  padding: '1rem 1.5rem 1.25rem',
                  background: '#f8fafc',
                  borderBottom: i < rows.length - 1 ? '1px solid var(--glass-border)' : 'none',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem', fontSize: '0.82rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Full Record ID: </span>
                      <code style={{ fontSize: '0.78rem' }}>{row.record_id || 'n/a'}</code>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Hash: </span>
                      <code style={{ fontSize: '0.78rem' }}>{row.hash?.slice(0, 24)}…</code>
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: 4 }}>Payload</div>
                    <pre style={{
                      background: '#f1f5f9', padding: '0.75rem', borderRadius: 8,
                      fontSize: '0.78rem', overflowX: 'auto', margin: 0,
                      border: '1px solid var(--border)', color: '#374151',
                    }}>
                      {JSON.stringify(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
        <button className="btn-ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)}
          style={{ padding: '0.4rem 0.75rem' }}>← Prev</button>
        <span style={{ padding: '0.4rem 0.75rem', color: 'var(--text-secondary)' }}>Page {page}</span>
        <button className="btn-ghost" disabled={rows.length < 30} onClick={() => setPage(p => p + 1)}
          style={{ padding: '0.4rem 0.75rem' }}>Next →</button>
      </div>
    </div>
  );
}
