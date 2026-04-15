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
        <img
          src="/procura-logo.png"
          alt="Procura"
          style={{
            height: 36,
            width: 'auto',
            background: '#fff',
            borderRadius: 8,
            padding: '4px 8px',
            display: 'block',
          }}
        />
      </div>
      <nav className="sidebar-nav">
        {visible.map(n => (
          <a key={n.id} className={`nav-item${tab === n.id ? ' active' : ''}`} onClick={() => setTab(n.id)}>
            <span style={{ fontSize: '1rem' }}>{n.icon}</span> {n.label}
          </a>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-name">{user?.full_name}</div>
          <div className="sidebar-user-meta">{user?.role} · {user?.email}</div>
        </div>
        <a className="nav-item" onClick={logout} style={{ color:'#f87171' }}>
          <span style={{ fontSize:'1rem' }}>🚪</span> Sign Out
        </a>
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
