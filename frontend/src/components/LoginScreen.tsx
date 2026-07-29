import { useState, type FormEvent } from 'react'
import { authApi } from '../api/auth'
import type { AuthUser } from '../types/auth'

interface LoginScreenProps {
  onLogin: (user: AuthUser) => void
  message?: string
}

export function LoginScreen({ onLogin, message }: LoginScreenProps) {
  // 密码只存在于组件内存，登录完成后立即清空，不写入浏览器存储。
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(message ?? '')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const result = await authApi.login(username.trim(), password)
      setPassword('')
      console.info('[login] authentication succeeded', { userId: result.user.id })
      onLogin(result.user)
    } catch (requestError) {
      console.warn('[login] authentication rejected')
      setError(requestError instanceof Error ? requestError.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <p className="eyebrow">ENTERPRISE AI PLATFORM</p>
          <h1>企业 AI 平台</h1>
          <p>使用管理员或普通用户账号登录。登录有效期为 1 小时。</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="username">用户名</label>
          <input
            autoComplete="username"
            id="username"
            maxLength={64}
            onChange={(event) => setUsername(event.target.value)}
            required
            value={username}
          />
          <label htmlFor="password">密码</label>
          <input
            autoComplete="current-password"
            id="password"
            maxLength={256}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <button className="button primary" disabled={submitting} type="submit">
            {submitting ? '正在验证…' : '登录'}
          </button>
          {error && <div className="error-banner" role="alert">{error}</div>}
        </form>
      </section>
    </main>
  )
}
