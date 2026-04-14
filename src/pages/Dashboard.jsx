import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const STATUS_COLOR = {
  Draft: '#64748b', Approved: '#3b82f6', Ordered: '#8b5cf6',
  Delivered: '#06b6d4', Paid: '#10b981', Disputed: '#f43f5e',
};

function KpiCard({ label, value, sub, subColor }) {
  return (
    <div className="glass-card stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-change" style={{ color: subColor || 'var(--text-secondary)' }}>{sub}</span>}
    </div>
  );
}

function StatusBar({ byStatus }) {
  const statuses = ['Draft', 'Approved', 'Ordered', 'Delivered', 'Paid', 'Disputed'];
  const total = statuses.reduce((a, s) => a + (byStatus[s] || 0), 0) || 1;
  return (
    <div style={{ display: 'flex', gap: 4, height: 8, borderRadius: 8, overflow: 'hidden', marginBottom: '1rem' }}>
      {statuses.map(s => (byStatus[s] ? (
        <div key={s} style={{
          width: `${((byStatus[s] || 0) / total) * 100}%`,
          background: STATUS_COLOR[s],
          transition: 'width 0.6s ease',
        }} title={`${s}: ${byStatus[s]}`} />
      ) : null))}
    </div>
  );
}

export default function Dashboard({ setTab }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [escalations, setEscalations] = useState({ open: [], resolved: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/api/dashboard/summary'),
      api.get('/api/dashboard/escalations'),
    ]).then(([s, e]) => {
      setSummary(s);
      setEscalations(e);
    }).catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;
  if (error)   return <div className="alert alert-error" style={{ margin: '2rem 0' }}>{error}</div>;

  const req = summary?.requisitions || {};
  const byStatus = req.by_status || {};

  return (
    <div className="animate-fade-in">
      <div className="topbar">
        <div className="header-title">
          <h1>Overview</h1>
          <p>Welcome back, <strong>{user?.full_name}</strong> · {user?.role}</p>
        </div>
        <button className="btn-primary" onClick={() => setTab('requisitions')}>+ New Requisition</button>
      </div>

      {/* KPI grid */}
      <div className="stats-grid">
        <KpiCard
          label="Total Requisitions"
          value={req.total ?? '—'}
          sub={`${req.overdue ?? 0} overdue`}
          subColor={req.overdue > 0 ? '#f43f5e' : '#10b981'}
        />
        <KpiCard
          label="Paid (30 days)"
          value={summary?.payments_30d?.count ?? '—'}
          sub={`ZMW ${Number(summary?.payments_30d?.total_amount || 0).toLocaleString()}`}
          subColor="#10b981"
        />
        <KpiCard
          label="Open Escalations"
          value={escalations.open.length}
          sub={escalations.open.length > 0 ? 'Requires attention' : 'All clear'}
          subColor={escalations.open.length > 0 ? '#f59e0b' : '#10b981'}
        />
        <KpiCard
          label="Blacklisted Suppliers"
          value={summary?.suppliers?.blacklisted ?? '—'}
          sub="Vendors blocked from engagement"
        />
      </div>

      <div className="section-grid">
        {/* Status breakdown */}
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem' }}>Requisition Status Breakdown</h3>
          <StatusBar byStatus={byStatus} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {Object.entries(STATUS_COLOR).map(([s, c]) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: c }} />
                <span style={{ color: 'var(--text-secondary)' }}>{s}</span>
                <strong>{byStatus[s] || 0}</strong>
              </div>
            ))}
          </div>

          {/* Disputed + Overdue callouts */}
          {(req.disputed > 0 || req.overdue > 0) && (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {req.overdue > 0 && (
                <div className="alert alert-warn" style={{ flex: 1 }}>
                  ⚠️ {req.overdue} requisition{req.overdue !== 1 ? 's' : ''} past SLA deadline
                </div>
              )}
              {req.disputed > 0 && (
                <div className="alert alert-error" style={{ flex: 1 }}>
                  🚨 {req.disputed} disputed requisition{req.disputed !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Open escalations */}
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3>Open Escalations</h3>
            {escalations.open.length > 0 && (
              <button className="btn-ghost" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                onClick={() => setTab('escalations')}>
                View all
              </button>
            )}
          </div>

          {escalations.open.length === 0 ? (
            <div className="empty-state">
              <span style={{ fontSize: 32 }}>✅</span>
              <p>No open escalations</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {escalations.open.slice(0, 5).map(e => (
                <div key={e.id} className="glass-card" style={{ padding: '1rem', background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)', cursor: 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <strong style={{ fontSize: '0.9rem' }}>{e.ref_number}</strong>
                    <span className={`status-badge tier-${e.tier?.toLowerCase()}`}>{e.tier}</span>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>{e.requisition_title}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
