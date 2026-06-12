import { useState, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { logout as logoutApi } from '../api'
import { queryClient } from '../main'

// ── User dropdown — click to open, outside click to close ────────────────────

function useClickDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  return { open, setOpen, ref }
}

// ── Dashboard dropdown (Overview + Projector) ─────────────────────────────

function DashboardDropdown({ active }) {
  const [open, setOpen]   = useState(false)
  const ref               = useRef(null)
  const closeTimer        = useRef(null)
  const location          = useLocation()

  const show = () => { clearTimeout(closeTimer.current); setOpen(true) }
  const hide = () => { closeTimer.current = setTimeout(() => setOpen(false), 120) }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  return (
    <div ref={ref} className="navbar-dropdown-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <button
        className={`navbar-link navbar-dropdown-trigger ${active ? 'active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        Dashboard
      </button>
      {open && (
        <div className="navbar-dropdown">
          <Link
            to="/"
            className={`navbar-dropdown-item ${location.pathname === '/' ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            Overview
          </Link>
          <Link
            to="/projector"
            className={`navbar-dropdown-item ${location.pathname === '/projector' ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            Projector
          </Link>
        </div>
      )}
    </div>
  )
}

// ── Budget dropdown — click label to navigate ─────────────────────────────

function BudgetDropdown({ active }) {
  const [open, setOpen]    = useState(false)
  const ref                = useRef(null)
  const closeTimer         = useRef(null)
  const location           = useLocation()
  const navigate           = useNavigate()

  const show = () => { clearTimeout(closeTimer.current); setOpen(true) }
  // Small delay lets the cursor travel into the dropdown without it snapping shut
  const hide = () => { closeTimer.current = setTimeout(() => setOpen(false), 120) }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const handleClick = () => setOpen(o => !o)

  return (
    <div
      ref={ref}
      className="navbar-dropdown-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        className={`navbar-link navbar-dropdown-trigger ${active ? 'active' : ''}`}
        onClick={handleClick}
      >
        Budget
      </button>
      {open && (
        <div className="navbar-dropdown">
          <Link
            to="/budget"
            className={`navbar-dropdown-item ${active && !location.search.includes('template') ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            Monthly Budget
          </Link>
          <Link
            to="/budget?view=template"
            className={`navbar-dropdown-item ${location.search.includes('template') ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            Template
          </Link>
        </div>
      )}
    </div>
  )
}

// ── Recurring dropdown (Income + Bills) ───────────────────────────────

function RecurringDropdown({ active }) {
  const [open, setOpen]   = useState(false)
  const ref               = useRef(null)
  const closeTimer        = useRef(null)
  const location          = useLocation()
  const navigate          = useNavigate()

  const show = () => { clearTimeout(closeTimer.current); setOpen(true) }
  const hide = () => { closeTimer.current = setTimeout(() => setOpen(false), 120) }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  return (
    <div ref={ref} className="navbar-dropdown-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <button
        className={`navbar-link navbar-dropdown-trigger ${active ? 'active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        Recurring
      </button>
      {open && (
        <div className="navbar-dropdown">
          <Link
            to="/income"
            className={`navbar-dropdown-item ${location.pathname === '/income' ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            Income
          </Link>
          <Link
            to="/bills"
            className={`navbar-dropdown-item ${location.pathname === '/bills' ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            Bills
          </Link>
        </div>
      )}
    </div>
  )
}

// ── Assets & Liabilities dropdown ────────────────────────────────────────────

function AssetsDropdown({ active }) {
  const [open, setOpen]  = useState(false)
  const ref              = useRef(null)
  const closeTimer       = useRef(null)
  const location         = useLocation()
  const navigate         = useNavigate()

  const show = () => { clearTimeout(closeTimer.current); setOpen(true) }
  const hide = () => { closeTimer.current = setTimeout(() => setOpen(false), 120) }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  return (
    <div ref={ref} className="navbar-dropdown-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <button
        className={`navbar-link navbar-dropdown-trigger ${active ? 'active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        Assets
      </button>
      {open && (
        <div className="navbar-dropdown">
          <Link
            to="/assets"
            className={`navbar-dropdown-item ${location.pathname === '/assets' ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            Assets
          </Link>
          <Link
            to="/liabilities"
            className={`navbar-dropdown-item ${location.pathname === '/liabilities' ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            Liabilities
          </Link>
        </div>
      )}
    </div>
  )
}

function UserDropdown({ username }) {
  const { open, setOpen, ref } = useClickDropdown()
  const { logout } = useAuth()
  const navigate   = useNavigate()

  const handleLogout = async () => {
    setOpen(false)
    try { await logoutApi() } catch (_) {}
    queryClient.clear()
    logout()
    navigate('/login')
  }

  return (
    <div ref={ref} className="navbar-dropdown-wrap">
      <button
        className="navbar-user-btn"
        onClick={() => setOpen(o => !o)}
      >
        {username}
      </button>
      {open && (
        <div className="navbar-dropdown navbar-dropdown--right">
          <Link
            to="/settings"
            className="navbar-dropdown-item"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <div className="navbar-dropdown-divider" />
          <button className="navbar-dropdown-item navbar-dropdown-item--danger" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// ── NavBar ────────────────────────────────────────────────────────────────────

function NavBar() {
  const { user }   = useAuth()
  const location   = useLocation()

  const isDashboardActive = ['/', '/projector'].includes(location.pathname)
  const isAssetsActive    = ['/assets', '/liabilities'].includes(location.pathname)
  const isRecurringActive = ['/income', '/bills'].includes(location.pathname)
  const isBudgetActive    = location.pathname === '/budget'

  const links = [
    { label: 'Dashboard', dropdown: 'dashboard' },
    { to: '/accounts',     label: 'Accounts'     },
    { to: '/transactions', label: 'Transactions' },
    { label: 'Budget',     dropdown: 'budget'    },
    { label: 'Recurring',  dropdown: 'recurring' },
    { label: 'Assets',     dropdown: 'assets'    },
  ]

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <div className="navbar-left">
          <span className="navbar-brand">Finance</span>
          <div className="navbar-links">
            {links.map((link, i) => {
              if (link.dropdown === 'dashboard') {
                return <DashboardDropdown key="dashboard" active={isDashboardActive} />
              }
              if (link.dropdown === 'budget') {
                return <BudgetDropdown key="budget" active={isBudgetActive} />
              }
              if (link.dropdown === 'recurring') {
                return <RecurringDropdown key="recurring" active={isRecurringActive} />
              }
              if (link.dropdown === 'assets') {
                return <AssetsDropdown key="assets" active={isAssetsActive} />
              }
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`navbar-link ${location.pathname === link.to ? 'active' : ''}`}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        </div>

        <div className="navbar-right">
          <UserDropdown username={user?.username} />
        </div>
      </div>
    </nav>
  )
}

export default NavBar