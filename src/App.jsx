import React, { useState } from 'react';
import './App.css';
import Requisitions from './components/Requisitions';

const REQUISITIONS = [
  { id: 'PR-2024-001', title: 'MacBook Pro 16" - Engineering', user: 'Sarah Jenkins', amount: '$3,499', status: 'pending' },
  { id: 'PR-2024-002', title: 'Office Furniture - Suite 300', user: 'Mark Evans', amount: '$12,800', status: 'approved' },
  { id: 'PR-2024-003', title: 'Cloud Hosting Subscription', user: 'Alex Reed', amount: '$1,200/mo', status: 'approved' },
  { id: 'PR-2024-004', title: 'Marketing Materials - Q2', user: 'Tina Miller', amount: '$5,500', status: 'rejected' },
  { id: 'PR-2024-005', title: 'Team Building Venue', user: 'James Bond', amount: '$2,500', status: 'pending' },
];

const Sidebar = ({ activeTab, setActiveTab }) => (
  <aside className="sidebar">
    <div className="sidebar-logo">
      <div style={{ width: 32, height: 32, background: 'var(--accent-color)', borderRadius: '8px' }}></div>
      <span>PROCURA</span>
    </div>
    
    <nav className="sidebar-nav">
      <a className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
        📊 Dashboard
      </a>
      <a className={`nav-item ${activeTab === 'requisitions' ? 'active' : ''}`} onClick={() => setActiveTab('requisitions')}>
        📑 Requisitions
      </a>
      <a className={`nav-item ${activeTab === 'suppliers' ? 'active' : ''}`} onClick={() => setActiveTab('suppliers')}>
        🤝 Suppliers
      </a>
      <a className={`nav-item ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>
        📦 Orders
      </a>
      <a className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>
        📈 Analytics
      </a>
    </nav>
    
    <div style={{ marginTop: 'auto' }}>
      <a className="nav-item">⚙️ Settings</a>
      <a className="nav-item">👤 Profile</a>
    </div>
  </aside>
);

const Dashboard = () => (
  <div className="animate-fade-in">
    <div className="topbar">
      <div className="header-title">
        <h1>Overview</h1>
        <p>Real-time procurement insights and actions.</p>
      </div>
      <button className="btn-primary">+ New Requisition</button>
    </div>

    <div className="stats-grid">
      <div className="glass-card stat-card">
        <span className="stat-label">Total Spend (Q2)</span>
        <span className="stat-value">$142,500</span>
        <span className="stat-change plus">↑ 12% vs last quarter</span>
      </div>
      <div className="glass-card stat-card">
        <span className="stat-label">Pending Approvals</span>
        <span className="stat-value">18</span>
        <span className="stat-change minus">↓ 4% vs last week</span>
      </div>
      <div className="glass-card stat-card">
        <span className="stat-label">Active Suppliers</span>
        <span className="stat-value">42</span>
        <span className="stat-change plus">↑ 2 new this month</span>
      </div>
      <div className="glass-card stat-card">
        <span className="stat-label">Savings Realized</span>
        <span className="stat-value">$24,300</span>
        <span className="stat-change plus">↑ Budget target on track</span>
      </div>
    </div>

    <div className="section-grid">
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3 style={{ marginBottom: '1.5rem' }}>Recent Requisitions</h3>
        <div className="recent-activity">
          {REQUISITIONS.map(req => (
            <div key={req.id} className="activity-item">
              <div className="activity-info">
                <span className="activity-user">{req.title}</span>
                <span className="activity-desc">Requested by {req.user} • {req.id}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                <span style={{ fontWeight: 600 }}>{req.amount}</span>
                <span className={`status-badge status-${req.status}`}>{req.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3 style={{ marginBottom: '1.5rem' }}>Supplier Performance</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {['CloudScale Inc.', 'OfficeDepot', 'LogiTech Solutions'].map((supplier, i) => (
            <div key={i} className="glass-card" style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <strong>{supplier}</strong>
                <span style={{ color: 'var(--accent-color)' }}>★ 4.{9-i}</span>
              </div>
              <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }}>
                <div style={{ width: `${80 - i*10}%`, height: '100%', background: 'var(--accent-color)', borderRadius: '2px' }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="app-container">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="main-content">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'requisitions' && <Requisitions />}
        {(activeTab !== 'dashboard' && activeTab !== 'requisitions') && (
          <div className="animate-fade-in" style={{ textAlign: 'center', marginTop: '10rem' }}>
            <h1 style={{ marginBottom: '1rem' }}>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
            <p style={{ color: 'var(--text-secondary)' }}>This module is currently under development.</p>
            <button className="btn-ghost" style={{ marginTop: '2rem' }} onClick={() => setActiveTab('dashboard')}>
              Back to Dashboard
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
