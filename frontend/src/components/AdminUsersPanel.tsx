import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { usersApi, type CreateUserPayload } from '../api/users'
import type { ManagedUser } from '../types/auth'

interface AdminUsersPanelProps {
  currentUserId: number
}

const emptyForm: CreateUserPayload = {
  username: '',
  displayName: '',
  password: '',
  role: 'user',
}

export function AdminUsersPanel({ currentUserId }: AdminUsersPanelProps) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [form, setForm] = useState<CreateUserPayload>(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setUsers(await usersApi.list())
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '用户加载失败')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await usersApi.create(form)
      setForm(emptyForm)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '用户创建失败')
    } finally {
      setSaving(false)
    }
  }

  async function update(
    user: ManagedUser,
    payload: Partial<Pick<ManagedUser, 'role' | 'isActive'>>,
  ) {
    setError('')
    try {
      await usersApi.update(user.id, payload)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '用户更新失败')
    }
  }

  return (
    <section className="panel admin-panel">
      <div className="section-heading">
        <div><p className="eyebrow">ADMINISTRATION</p><h2>用户与权限</h2></div>
        <button className="button ghost" onClick={() => void load()} type="button">刷新</button>
      </div>
      <form className="user-create-form" onSubmit={create}>
        <input
          maxLength={64}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
          placeholder="用户名"
          required
          value={form.username}
        />
        <input
          maxLength={100}
          onChange={(event) => setForm({ ...form, displayName: event.target.value })}
          placeholder="显示名称"
          required
          value={form.displayName}
        />
        <input
          minLength={12}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          placeholder="初始密码（至少12位）"
          required
          type="password"
          value={form.password}
        />
        <select
          onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'user' })}
          value={form.role}
        >
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <button className="button primary" disabled={saving} type="submit">创建用户</button>
      </form>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="user-table-wrap">
        <table className="user-table">
          <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>最近登录</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td><strong>{user.displayName}</strong><small>{user.username}</small></td>
                <td>
                  <select
                    disabled={user.id === currentUserId}
                    onChange={(event) => void update(user, { role: event.target.value })}
                    value={user.role}
                  >
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </td>
                <td>
                  <button
                    className={`status-toggle ${user.isActive ? 'active' : 'disabled'}`}
                    disabled={user.id === currentUserId}
                    onClick={() => void update(user, { isActive: !user.isActive })}
                    type="button"
                  >
                    {user.isActive ? '已启用' : '已禁用'}
                  </button>
                </td>
                <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
