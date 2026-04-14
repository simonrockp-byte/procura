import React, { useState } from 'react';

const REQUISITIONS = [
  { id: 'PR-2024-001', title: 'MacBook Pro 16" - Engineering', user: 'Sarah Jenkins', department: 'IT', amount: '$3,499', status: 'pending', date: '2024-04-12' },
  { id: 'PR-2024-002', title: 'Office Furniture - Suite 300', user: 'Mark Evans', department: 'Facilities', amount: '$12,800', status: 'approved', date: '2024-04-10' },
  { id: 'PR-2024-003', title: 'Cloud Hosting Subscription', user: 'Alex Reed', department: 'Engineering', amount: '$1,200/mo', status: 'approved', date: '2024-04-08' },
];

const Requisitions = () => {
  const [filter, setFilter] = useState('all');

  const filtered = REQUISITIONS.filter(r => filter === 'all' || r.status === filter);

  return (
    <div className="animate-fade-in">
      <div className="topbar">
        <div className="header-title">
          <h1>Purchase Requisitions</h1>
          <p>Manage and track internal purchase requests.</p>
        </div>
        <button className="btn-primary">+ Create New Request</button>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
          {['all', 'pending', 'approved', 'rejected'].map(f => (
            <button 
              key={f}
              className={`btn-ghost ${filter === f ? 'active' : ''}`}
              style={{ textTransform: 'capitalize', padding: '0.5rem 1rem' }}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '1rem' }}>ID & Title</th>
              <th style={{ padding: '1rem' }}>Requester</th>
              <th style={{ padding: '1rem' }}>Department</th>
              <th style={{ padding: '1rem' }}>Amount</th>
              <th style={{ padding: '1rem' }}>Date</th>
              <th style={{ padding: '1rem' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(req => (
              <tr key={req.id} className="activity-item" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 600 }}>{req.title}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{req.id}</div>
                </td>
                <td style={{ padding: '1rem' }}>{req.user}</td>
                <td style={{ padding: '1rem' }}>{req.department}</td>
                <td style={{ padding: '1rem', fontWeight: 600 }}>{req.amount}</td>
                <td style={{ padding: '1rem', fontSize: '0.9rem' }}>{req.date}</td>
                <td style={{ padding: '1rem' }}>
                  <span className={`status-badge status-${req.status}`}>{req.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Requisitions;
