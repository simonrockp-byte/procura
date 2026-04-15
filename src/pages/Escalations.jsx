import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const TIER_COLOR = { Officer: '#64748b', Manager: '#f59e0b', Executive: '#f43f5e' };

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 36e5);
  const m = Math.floor((diff % 36e5) / 6e4);
  if (h > 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

function hoursUntilAutoEscalate(triggeredAt, autoEscalateHours = 2) {
  const elapsed = (Date.now() - new Date(triggeredAt).getTime()) / 36e5;
  const remaining = autoEscalateHours - elapsed;
  return remaining > 0 ? remaining.toFixed(1) : null;
}

export default function Escalations() {
  const { user } = useAuth();
  const canAck = ['Manager', 'Executive'].includes(user?.role);

  const [data, setData]     = useState({ open: [], resolved: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [acking, setAcking] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get('/api/dashboard/escalations');
      setData(result);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function acknowledge(id) {
    setAcking(id);
    try {
      await api.post(`/api/dashboard/escalations/${id}/acknowledge`, {});
      load();
    } catch (e) { alert(e.message); }
    finally { setAcking(null); }
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;
  if (error)   return <div className="alert alert-error" style={{ margin: '2rem 0' }}>{error}</div>;

  return (
    <div className="animate-fade-in">
      <div className="topbar">
        <div className="header-title">
          <h1>Escalations</h1>
          <p>Unacknowledged alerts auto-escalate every 2 hours: Officer → Manager → Executive.</p>
        </div>
        <button className="btn-ghost" onClick={load} style={{ padding: '0.5rem 1rem' }}>↻ Refresh</button>
      </div>

      {/* Open escalations */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Open ({data.open.length})
        </h3>

        {data.open.length === 0 ? (
          <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: '1rem' }}>✅</div>
            <p style={{ color: 'var(--text-secondary)' }}>No open escalations — all SLAs are on track</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {data.open.map(e => {
              const remaining = hoursUntilAutoEscalate(e.triggered_at);
              const isUrgent = remaining !== null && parseFloat(remaining) < 0.5;
              return (
                <div key={e.id} className="glass-panel" style={{
                  padding: '1.5rem',
                  borderColor: isUrgent ? '#fecaca' : '#fde68a',
                  background: isUrgent ? '#fef2f2' : '#fffbeb',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '1.05rem' }}>{e.ref_number}</strong>
                        <span className="status-badge" style={{
                          background: `${TIER_COLOR[e.tier]}20`,
                          color: TIER_COLOR[e.tier],
                        }}>
                          {e.tier} tier
                        </span>
                        <span className={`status-badge status-${e.requisition_status?.toLowerCase()}`}>
                          {e.requisition_status}
                        </span>
                      </div>
                      <p style={{ color: 'var(--text-secondary)', margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                        {e.requisition_title}
                      </p>
                      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          🕐 Triggered {timeAgo(e.triggered_at)}
                        </span>
                        {e.sla_deadline && (
                          <span style={{ fontSize: '0.8rem', color: '#f43f5e' }}>
                            ⚠️ SLA expired {timeAgo(e.sla_deadline)}
                          </span>
                        )}
                        {remaining !== null && (
                          <span style={{ fontSize: '0.8rem', color: isUrgent ? '#f43f5e' : '#f59e0b' }}>
                            ⏱ Auto-escalates in {remaining}h
                          </span>
                        )}
                        {!remaining && e.tier !== 'Executive' && (
                          <span style={{ fontSize: '0.8rem', color: '#f43f5e' }}>
                            🚨 Pending auto-escalation to next tier
                          </span>
                        )}
                      </div>
                    </div>
                    {canAck && (
                      <button
                        className="btn-primary"
                        style={{ whiteSpace: 'nowrap', fontSize: '0.875rem' }}
                        disabled={acking === e.id}
                        onClick={() => acknowledge(e.id)}
                      >
                        {acking === e.id ? 'Acknowledging…' : 'Acknowledge'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Resolved escalations */}
      {data.resolved.length > 0 && (
        <div>
          <h3 style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recently Resolved ({data.resolved.length})
          </h3>
          <div className="glass-panel" style={{ padding: '0' }}>
            {data.resolved.map((e, i) => (
              <div key={e.id} style={{
                padding: '1rem 1.5rem',
                borderBottom: i < data.resolved.length - 1 ? '1px solid var(--glass-border)' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
              }}>
                <div>
                  <span style={{ fontWeight: 600, marginRight: '0.75rem' }}>{e.ref_number}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{e.requisition_title}</span>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="status-badge" style={{ background: `${TIER_COLOR[e.tier]}20`, color: TIER_COLOR[e.tier] }}>{e.tier}</span>
                  <span style={{ fontSize: '0.8rem', color: '#10b981' }}>
                    ✓ Acknowledged by {e.acknowledged_by_name} · {timeAgo(e.acknowledged_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
