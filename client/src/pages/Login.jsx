import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { login as loginApi, register as registerApi } from '../api'

function Login() {
  const [mode, setMode]         = useState('login')  // 'login' or 'register'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)

  const { login } = useAuth()
  const navigate  = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const apiFn = mode === 'login' ? loginApi : registerApi
      const res   = await apiFn({ username, password })
      login(res.data)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <h1 className="login-title">Finance Dashboard</h1>
        <p className="login-sub">
          {mode === 'login' ? 'Sign in to continue' : 'Create an account'}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          {error && <div className="error-msg">{error}</div>}

          <button
            type="submit"
            className="btn-primary full-width"
            disabled={loading}
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="login-switch">
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button className="btn-link" onClick={() => { setMode('register'); setError(null) }}>
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button className="btn-link" onClick={() => { setMode('login'); setError(null) }}>
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Login