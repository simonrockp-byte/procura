import { useState, useEffect } from 'react';
import './App.css';
import { useAuth } from './context/AuthContext';
import Login        from './pages/Login';
import Dashboard    from './pages/Dashboard';
import Requisitions from './pages/Requisitions';
import Suppliers    from './pages/Suppliers';
import Escalations  from './pages/Escalations';
import AuditLog     from './pages/AuditLog';
import Deliveries   from './pages/Deliveries';
import Payments     from './pages/Payments';
import Officers     from './pages/Officers';
import AcceptInvite from './pages/AcceptInvite';

const NAV = [
  { id: 'dashboard',    label: 'Dashboard',    icon: '📊', roles: ['Officer','Manager','Executive','Auditor'] },
  { id: 'requisitions', label: 'Requisitions', icon: '📑', roles: ['Officer','Manager','Executive','Auditor'] },
  { id: 'suppliers',    label: 'Suppliers',    icon: '🤝', roles: ['Officer','Manager','Executive','Auditor'] },
  { id: 'deliveries',   label: 'Deliveries',   icon: '📦', roles: ['Officer','Manager','Executive','Auditor'] },
  { id: 'payments',     label: 'Payments',     icon: '💰', roles: ['Manager','Executive'] },
  { id: 'officers',     label: 'Officers',     icon: '👥', roles: ['Manager','Executive','Auditor'] },
  { id: 'escalations',  label: 'Escalations',  icon: '🚨', roles: ['Manager','Executive'] },
  { id: 'audit',        label: 'Audit Log',    icon: '🔐', roles: ['Executive','Auditor'] },
];

function Sidebar({ tab, setTab, user, logout }) {
  const visible = NAV.filter(n => n.roles.includes(user?.role));
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div style={{ width:32, height:32, background:'var(--accent-color)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, color:'#000', fontSize:18, flexShrink:0 }}>P</div>
        <span>PROCURA</span>
      </div>
      <nav className="sidebar-nav">
        {visible.map(n => (
          <a key={n.id} className={`nav-item${tab === n.id ? ' active' : ''}`} onClick={() => setTab(n.id)}>
            {n.icon} {n.label}
          </a>
        ))}
      </nav>
      <div style={{ marginTop:'auto', borderTop:'1px solid var(--glass-border)', paddingTop:'1.5rem' }}>
        <div style={{ padding:'0.75rem 1rem', marginBottom:'0.5rem' }}>
          <div style={{ fontWeight:600, fontSize:'0.9rem' }}>{user?.full_name}</div>
          <div style={{ color:'var(--text-secondary)', fontSize:'0.78rem' }}>{user?.role} · {user?.email}</div>
        </div>
        <a className="nav-item" onClick={logout} style={{ color:'#f43f5e', cursor: 'pointer' }}>🚪 Sign Out</a>
      </div>
    </aside>
  );
}

export default function App() {
  const { user, isAuthed, logout } = useAuth();
  const [tab, setTab] = useState('dashboard');
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Handle unauthed routes first
  if (path === '/accept-invite') {
    return <AcceptInvite />;
  }

  if (!isAuthed) return <Login />;

  const pages = {
    dashboard:    <Dashboard setTab={setTab} />,
    requisitions: <Requisitions />,
    suppliers:    <Suppliers />,
    deliveries:   <Deliveries />,
    payments:     <Payments />,
    officers:     <Officers />,
    escalations:  <Escalations />,
    audit:        <AuditLog />,
  };

  return (
    <div className="app-container">
      <Sidebar tab={tab} setTab={setTab} user={user} logout={logout} />
      <main className="main-content">{pages[tab] ?? pages.dashboard}</main>
    </div>
  );
}
