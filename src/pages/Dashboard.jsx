import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [officers, setOfficers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [escalations, setEscalations] = useState({ open: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [sum, off, ven, esc] = await Promise.all([
          api.get('/api/dashboard/summary'),
          api.get('/api/dashboard/officer-activity'),
          api.get('/api/dashboard/vendor-performance'),
          api.get('/api/dashboard/escalations'),
        ]);
        setSummary(sum);
        setOfficers(off);
        setVendors(ven.slice(0, 5)); // Top 5
        setEscalations(esc);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  const stats = summary?.requisitions?.by_status || {};
  const total = summary?.requisitions?.total || 1;

  return (
    <div className="animate-fade-in">
      <div className="topbar">
        <div className="header-title">
          <h1>System Overview</h1>
          <p>Live compliance and procurement metrics.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid">
        <div className="glass-card stat-card">
          <span className="stat-label">Pending Escalations</span>
          <span className="stat-value" style={{ color: escalations.open.length > 0 ? '#f59e0b' : 'inherit' }}>
            {escalations.open.length}
          </span>
          <span className="stat-change">Requires immediate attention</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Spend (Last 30d)</span>
          <span className="stat-value">ZMW {summary?.payments_30d?.total_amount.toLocaleString()}</span>
          <span className="stat-change">Across {summary?.payments_30d?.count} clearances</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Compliance Score</span>
          <span className="stat-value">94.2%</span>
          <span className="stat-change plus">↑ 0.4% from last month</span>
        </div>
        <div className="glass-card stat-card">
          <span className="stat-label">Blacklisted Vendors</span>
          <span className="stat-value" style={{ color: '#f43f5e' }}>{summary?.suppliers?.blacklisted}</span>
          <span className="stat-change">Restricted from engagement</span>
        </div>
      </div>

      <div className="section-grid">
        {/* Status Breakdown Chart (CSS based) */}
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3>Requisition Pipeline</h3>
          <div style={{ display: 'flex', height: 40, borderRadius: 8, overflow: 'hidden', margin: '2rem 0' }}>
            {['Approved', 'Ordered', 'Delivered', 'Paid', 'Disputed', 'Draft'].map(s => {
              const count = stats[s] || 0;
              const width = (count / total) * 100;
              if (width === 0) return null;
              return (
                <div key={s} 
                  style={{ width: `${width}%`, background: `var(--status-${s.toLowerCase()})`, position: 'relative' }}
                  title={`${s}: ${count}`}
                />
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            {['Approved', 'Ordered', 'Delivered', 'Paid', 'Disputed', 'Draft'].map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: `var(--status-${s.toLowerCase()})` }} />
                <span style={{ color: 'var(--text-secondary)' }}>{s}:</span>
                <span style={{ fontWeight: 600 }}>{stats[s] || 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Escalations Preview */}
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3>Alerts</h3>
          <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {escalations.open.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No active escalations.</div>
            ) : (
              escalations.open.slice(0, 3).map(e => (
                <div key={e.id} className="glass-card" style={{ padding: '0.75rem', background: '#fef2f2', borderColor: '#fecaca' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{e.ref_number} — SLA Overdue</span>
                    <span className="status-badge status-rejected" style={{ fontSize: '0.7rem' }}>{e.tier}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{e.requisition_title}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* New Section: Officer Activity & Vendor Performance */}
      <div className="section-grid" style={{ marginTop: '2.5rem', gridTemplateColumns: '1fr 1fr' }}>
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3>Officer Engagement (Last 30d)</h3>
          <table className="data-table" style={{ fontSize: '0.85rem', marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Officer</th>
                <th style={{ textAlign: 'center' }}>Reqs</th>
                <th style={{ textAlign: 'center' }}>Dels</th>
                <th style={{ textAlign: 'center' }}>Pays</th>
              </tr>
            </thead>
            <tbody>
              {officers.slice(0, 5).map(o => (
                <tr key={o.id}>
                  <td>{o.full_name}</td>
                  <td style={{ textAlign: 'center' }}>{o.requisitions_created}</td>
                  <td style={{ textAlign: 'center' }}>{o.deliveries_confirmed}</td>
                  <td style={{ textAlign: 'center' }}>{o.payments_processed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3>Top Suppliers</h3>
          <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {vendors.map(v => (
              <div key={v.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                  <span>{v.name}</span>
                  <span style={{ fontWeight: 600 }}>{v.compliance_score}%</span>
                </div>
                <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ 
                    height: '100%', 
                    width: `${v.compliance_score}%`, 
                    background: v.compliance_score >= 80 ? '#10b981' : (v.compliance_score >= 50 ? '#f59e0b' : '#f43f5e')
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
