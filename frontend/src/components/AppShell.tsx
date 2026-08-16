import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { navForRole } from '../lib/nav'
import { Icon } from './Icon'
import { Avatar } from './StatCard'
import './AppShell.css'

function SidebarContent({ onNavigate }: { onNavigate: () => void }) {
  const { user, school, logout } = useAuth()
  const role = user?.role
  const items = role ? navForRole(role) : []

  return (
    <>
      <div className="app-sidebar-header">
        <span className="logo-mark" aria-hidden="true">
          S
        </span>
        <span>Scholarion</span>
      </div>
      <nav className="app-nav" aria-label="Main navigation">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={onNavigate}
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="app-sidebar-footer">
        <Avatar name={user?.full_name ?? ''} />
        <div className="user-meta">
          <div className="user-name">{user?.full_name}</div>
          <div className="user-role">{role} &middot; {school?.name}</div>
        </div>
        <button className="sidebar-logout" onClick={() => void logout()} aria-label="Sign out" title="Sign out">
          <Icon name="logout" size={17} />
        </button>
      </div>
    </>
  )
}

export function AppShell() {
  const { school } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside className={`app-sidebar ${open ? 'open' : ''}`}>
        <SidebarContent onNavigate={() => setOpen(false)} />
      </aside>
      {open ? <div className="sidebar-backdrop" onClick={() => setOpen(false)} /> : null}
      <div className="app-main">
        <header className="app-topbar">
          <button className="sidebar-toggle" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation" aria-expanded={open}>
            <Icon name="list" size={18} />
          </button>
          <div>
            <div className="school-name">{school?.name ?? 'Scholarion'}</div>
            <div className="school-sub">
              {school ? `${school.slug} · ${school.timezone}` : ''}
            </div>
          </div>
        </header>
        <main id="main-content" className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
