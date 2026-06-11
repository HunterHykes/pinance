import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Accounts from './pages/Accounts'
import Assets from './pages/Assets'
import Liabilities from './pages/Liabilities'
import Budget from './pages/Budget'
import Settings from './pages/Settings'
import Bills from './pages/Bills'
import Income from './pages/Income'
import Projector from './pages/Projector'
import NavBar from './components/NavBar'

// Redirects to login if not authenticated
function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading">Loading...</div>
  return user ? children : <Navigate to="/login" replace />
}

function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading">Loading...</div>

  return (
    <div className="app">
      {user && <NavBar />}
      <main className="main-content">
        <Routes>
          <Route path="/login" element={
            user ? <Navigate to="/" replace /> : <Login />
          } />
          <Route path="/" element={
            <PrivateRoute><Dashboard /></PrivateRoute>
          } />
          <Route path="/transactions" element={
            <PrivateRoute><Transactions /></PrivateRoute>
          } />
          <Route path="/accounts" element={
            <PrivateRoute><Accounts /></PrivateRoute>
          } />
          <Route path="/assets" element={
            <PrivateRoute><Assets /></PrivateRoute>
          } />
          <Route path="/liabilities" element={
            <PrivateRoute><Liabilities /></PrivateRoute>
          } />
          <Route path="/budget" element={
            <PrivateRoute><Budget /></PrivateRoute>
          } />
          <Route path="/bills" element={
            <PrivateRoute><Bills /></PrivateRoute>
          } />
          <Route path="/income" element={
            <PrivateRoute><Income /></PrivateRoute>
          } />
          <Route path="/projector" element={
            <PrivateRoute><Projector /></PrivateRoute>
          } />
          <Route path="/settings" element={
            <PrivateRoute><Settings /></PrivateRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default App