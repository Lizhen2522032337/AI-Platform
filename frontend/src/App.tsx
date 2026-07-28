import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { authApi } from './api/auth'
import { tasksApi } from './api/tasks'
import { AdminUsersPanel } from './components/AdminUsersPanel'
import { LoginScreen } from './components/LoginScreen'
import type { AuthUser } from './types/auth'
import type { AiTask, ModelProvider, TaskEvent, TaskStatus } from './types/task'
import './App.css'

const statusText: Record<TaskStatus, string> = {
  queued: '等待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
}

function App() {
  const [sessionLoading, setSessionLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [prompt, setPrompt] = useState('')
  const [modelProvider, setModelProvider] = useState<ModelProvider>('deepseek')
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    authApi.me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setSessionLoading(false))
  }, [])

  useEffect(() => {
    const expire = () => {
      setUser(null)
      setTasks([])
      setError('登录已过期，请重新登录。')
    }
    window.addEventListener('auth:expired', expire)
    return () => window.removeEventListener('auth:expired', expire)
  }, [])

  const loadTasks = useCallback(async () => {
    if (!user) return
    try {
      const freshTasks = await tasksApi.list()
      setTasks((current) =>
        freshTasks.map((task) => ({
          ...task,
          partialText: current.find((item) => item.id === task.id)?.partialText,
        })),
      )
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '任务加载失败')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    const initial = window.setTimeout(() => void loadTasks(), 0)
    const timer = window.setInterval(() => void loadTasks(), 10000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [loadTasks, user])

  const activeTaskIds = useMemo(
    () => tasks
      .filter((task) => task.status === 'queued' || task.status === 'processing')
      .map((task) => task.id)
      .join(','),
    [tasks],
  )

  // Gin 验证 HttpOnly Cookie 后提供 SSE；连接异常时仍有定时刷新兜底。
  useEffect(() => {
    if (!user || !activeTaskIds) return
    const sources = activeTaskIds.split(',').map((taskId) => {
      const source = new EventSource(tasksApi.eventsUrl(Number(taskId)), {
        withCredentials: true,
      })
      source.addEventListener('task', (event) => {
        const update = JSON.parse((event as MessageEvent<string>).data) as TaskEvent
        setTasks((current) =>
          current.map((task) =>
            task.id === update.id
              ? {
                  ...task,
                  status: update.status,
                  modelName: update.modelName ?? task.modelName,
                  partialText: update.partialText ?? task.partialText,
                  result: update.result ?? task.result,
                  answer: update.result?.text ?? task.answer,
                  errorMessage: update.errorMessage ?? task.errorMessage,
                }
              : task,
          ),
        )
        if (update.status === 'completed' || update.status === 'failed') {
          source.close()
          void loadTasks()
        }
      })
      source.onerror = () => source.close()
      return source
    })
    return () => sources.forEach((source) => source.close())
  }, [activeTaskIds, loadTasks, user])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt) {
      setError('请输入任务内容。')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const task = await tasksApi.create(cleanPrompt, modelProvider)
      setTasks((current) => [task, ...current])
      setPrompt('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '任务提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function logout() {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      setTasks([])
      setError('')
    }
  }

  function acceptLogin(authenticated: AuthUser) {
    setLoading(true)
    setUser(authenticated)
    setError('')
  }

  if (sessionLoading) {
    return <main className="login-shell"><div className="session-loading">正在验证登录状态…</div></main>
  }
  if (!user) return <LoginScreen message={error} onLogin={acceptLogin} />

  const canCreateTask = user.permissions.includes('tasks:create')
  const canManageUsers = user.permissions.includes('users:manage')

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">ENTERPRISE AI PLATFORM</p>
          <h1>企业 AI 异步任务控制台</h1>
          <p className="hero-copy">
            NestJS 统一认证和鉴权，RabbitMQ 分发任务，Worker 调用 FastAPI，
            Gin 通过 Redis 推送当前用户有权查看的实时状态。
          </p>
        </div>
        <div className="account-box">
          <span className="status-chip"><span className="status-dot" />系统在线</span>
          <div><strong>{user.displayName}</strong><small>{user.role === 'admin' ? '管理员' : '普通用户'} · {user.username}</small></div>
          <button className="button account-logout" onClick={() => void logout()} type="button">退出</button>
        </div>
      </header>

      <section className="architecture panel" aria-label="系统处理链路">
        {['React', 'Nginx', 'NestJS 鉴权', 'RabbitMQ', 'Worker', 'FastAPI', 'DeepSeek · 千问', 'Qdrant · MinIO'].map(
          (name, index, all) => (
            <div className="flow-step" key={name}>
              <span>{name}</span>{index < all.length - 1 && <b>→</b>}
            </div>
          ),
        )}
      </section>

      <div className="workspace-grid">
        {canCreateTask && (
          <section className="panel">
            <p className="eyebrow">NEW AI TASK</p>
            <h2>提交处理任务</h2>
            <form className="task-form" onSubmit={submit}>
              <label htmlFor="prompt">任务内容</label>
              <textarea
                id="prompt"
                maxLength={4000}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="例如：总结这份设备巡检记录并提取风险点"
                rows={8}
                value={prompt}
              />
              <label htmlFor="model-provider">选择大模型</label>
              <select
                id="model-provider"
                onChange={(event) => setModelProvider(event.target.value as ModelProvider)}
                value={modelProvider}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">通义千问</option>
              </select>
              <button className="button primary" disabled={submitting} type="submit">
                {submitting ? '正在提交…' : '提交到 RabbitMQ'}
              </button>
            </form>
            {error && <div className="error-banner" role="alert">{error}</div>}
          </section>
        )}

        <section className="panel records-panel">
          <div className="section-heading">
            <div><p className="eyebrow">TASK STREAM</p><h2>{user.role === 'admin' ? '全部任务状态' : '我的任务状态'}</h2></div>
            <button className="button ghost" onClick={() => void loadTasks()} type="button">刷新</button>
          </div>
          {!canCreateTask && error && <div className="error-banner" role="alert">{error}</div>}
          {loading ? <div className="empty-state">正在加载…</div> : tasks.length === 0 ? (
            <div className="empty-state">暂无任务。</div>
          ) : (
            <div className="task-list">
              {tasks.map((task) => (
                <article className="task-card" key={task.id}>
                  <div className="task-card-head">
                    <strong>#{task.id}{user.role === 'admin' && task.createdById ? ` · 用户 ${task.createdById}` : ''}</strong>
                    <div className="task-badges">
                      <span className="model-badge">
                        {task.modelProvider === 'qwen' ? '通义千问' : 'DeepSeek'}
                        {task.modelName ? ` · ${task.modelName}` : ''}
                      </span>
                      <span className={`task-status ${task.status}`}>{statusText[task.status]}</span>
                    </div>
                  </div>
                  <p>{task.prompt}</p>
                  {(task.partialText || task.answer || task.result?.text) && (
                    <div className={`result-box ${task.status === 'processing' ? 'streaming' : ''}`}>
                      {task.partialText || task.answer || task.result?.text}
                      {task.status === 'processing' && <span className="stream-cursor" aria-hidden="true" />}
                    </div>
                  )}
                  {task.errorMessage && <div className="inline-error">{task.errorMessage}</div>}
                  <small>{new Date(task.updatedAt).toLocaleString('zh-CN')}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {canManageUsers && <AdminUsersPanel currentUserId={user.id} />}
    </main>
  )
}

export default App
