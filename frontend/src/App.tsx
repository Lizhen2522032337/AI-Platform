import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { tasksApi } from './api/tasks'
import type { AiTask, TaskEvent, TaskStatus } from './types/task'
import './App.css'

const statusText: Record<TaskStatus, string> = {
  queued: '等待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
}

function App() {
  const [prompt, setPrompt] = useState('')
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await tasksApi.list())
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '任务加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTasks()
    const timer = window.setInterval(() => void loadTasks(), 10000)
    return () => window.clearInterval(timer)
  }, [loadTasks])

  const activeTask = useMemo(
    () => tasks.find((task) => task.status === 'queued' || task.status === 'processing'),
    [tasks],
  )

  // Gin 提供 SSE 实时状态；连接异常时仍有上面的定时刷新兜底。
  useEffect(() => {
    if (!activeTask) return
    const source = new EventSource(tasksApi.eventsUrl(activeTask.id))
    source.addEventListener('task', (event) => {
      const update = JSON.parse((event as MessageEvent<string>).data) as TaskEvent
      setTasks((current) =>
        current.map((task) =>
          task.id === update.id
            ? {
                ...task,
                status: update.status,
                result: update.result ?? task.result,
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
    return () => source.close()
  }, [activeTask, loadTasks])

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
      const task = await tasksApi.create(cleanPrompt)
      setTasks((current) => [task, ...current])
      setPrompt('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '任务提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">ENTERPRISE AI PLATFORM</p>
          <h1>企业 AI 异步任务控制台</h1>
          <p className="hero-copy">
            NestJS 接收业务请求，RabbitMQ 分发任务，Worker 调用 FastAPI，
            Gin 通过 Redis 推送实时状态。
          </p>
        </div>
        <span className="status-chip"><span className="status-dot" />系统在线</span>
      </header>

      <section className="architecture panel" aria-label="系统处理链路">
        {['React', 'Nginx', 'NestJS', 'RabbitMQ', 'Worker', 'FastAPI', 'Qdrant · MinIO'].map(
          (name, index, all) => (
            <div className="flow-step" key={name}>
              <span>{name}</span>{index < all.length - 1 && <b>→</b>}
            </div>
          ),
        )}
      </section>

      <div className="workspace-grid">
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
            <button className="button primary" disabled={submitting} type="submit">
              {submitting ? '正在提交…' : '提交到 RabbitMQ'}
            </button>
          </form>
          {error && <div className="error-banner" role="alert">{error}</div>}
        </section>

        <section className="panel records-panel">
          <div className="section-heading">
            <div><p className="eyebrow">TASK STREAM</p><h2>任务状态</h2></div>
            <button className="button ghost" onClick={() => void loadTasks()} type="button">刷新</button>
          </div>
          {loading ? <div className="empty-state">正在加载…</div> : tasks.length === 0 ? (
            <div className="empty-state">暂无任务，请先提交一个 AI 任务。</div>
          ) : (
            <div className="task-list">
              {tasks.map((task) => (
                <article className="task-card" key={task.id}>
                  <div className="task-card-head">
                    <strong>#{task.id}</strong>
                    <span className={`task-status ${task.status}`}>{statusText[task.status]}</span>
                  </div>
                  <p>{task.prompt}</p>
                  {task.result?.text && <div className="result-box">{task.result.text}</div>}
                  {task.errorMessage && <div className="inline-error">{task.errorMessage}</div>}
                  <small>{new Date(task.updatedAt).toLocaleString('zh-CN')}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default App
