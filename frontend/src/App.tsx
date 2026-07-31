import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { authApi } from './api/auth'
import { conversationsApi } from './api/conversations'
import { tasksApi } from './api/tasks'
import { AdminUsersPanel } from './components/AdminUsersPanel'
import { LoginScreen } from './components/LoginScreen'
import type { AuthUser } from './types/auth'
import type { ChatConversation } from './types/conversation'
import type { AiTask, DatabaseType, ModelProvider, TaskEvent } from './types/task'
import './App.css'

function modelLabel(provider: ModelProvider) {
  // 后端只接受稳定的 provider code，中文名称仅用于界面显示。
  return provider === 'qwen' ? '通义千问' : 'DeepSeek'
}

function databaseLabel(databaseType: DatabaseType) {
  return databaseType === 'db2' ? 'DB2' : 'PostgreSQL'
}

function App() {
  // 会话身份：JWT 保存在 HttpOnly Cookie，React 只持有可公开的用户资料。
  const [sessionLoading, setSessionLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  // 对话状态：左侧会话列表、当前会话 ID，以及当前会话的一轮轮任务。
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null)
  const [tasks, setTasks] = useState<AiTask[]>([])
  const [prompt, setPrompt] = useState('')
  const [modelProvider, setModelProvider] = useState<ModelProvider>('deepseek')
  // 数据源随每轮任务持久化；DB2 暂不可用时仍可保留选项并返回明确错误。
  const [databaseType, setDatabaseType] = useState<DatabaseType>('postgresql')
  // 界面状态：首次加载、提交中、错误提示、管理员视图和移动端侧栏。
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingConversationId, setDeletingConversationId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [showAdmin, setShowAdmin] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const messageEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 页面刷新时使用 Cookie 恢复登录态，不在 localStorage 保存 access token。
    authApi.me()
      .then((authenticated) => {
        console.info('[session] restored', { userId: authenticated.id, role: authenticated.role })
        setUser(authenticated)
      })
      .catch(() => {
        console.info('[session] no active login')
        setUser(null)
      })
      .finally(() => setSessionLoading(false))
  }, [])

  useEffect(() => {
    // API 客户端遇到 401 时统一广播事件，让所有界面状态同时清空。
    const expire = () => {
      console.warn('[session] expired or revoked')
      setUser(null)
      setConversations([])
      setTasks([])
      setError('登录已过期，请重新登录。')
    }
    window.addEventListener('auth:expired', expire)
    return () => window.removeEventListener('auth:expired', expire)
  }, [])

  const loadConversations = useCallback(async () => {
    if (!user) return
    try {
      const items = await conversationsApi.list()
      console.info('[conversation] list loaded', { count: items.length })
      setConversations(items)
      setActiveConversationId((current) =>
        current && items.some((item) => item.id === current)
          ? current
          : (items[0]?.id ?? null),
      )
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '会话加载失败')
    }
  }, [user])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(), 0)
    return () => window.clearTimeout(timer)
  }, [loadConversations])

  const loadConversation = useCallback(async () => {
    if (!activeConversationId || showAdmin) return
    setLoading(true)
    try {
      const detail = await conversationsApi.detail(activeConversationId)
      console.info('[conversation] detail loaded', {
        conversationId: activeConversationId,
        turns: detail.tasks.length,
      })
      setTasks((current) =>
        detail.tasks.map((task) => ({
          ...task,
          partialText: current.find((item) => item.id === task.id)?.partialText,
        })),
      )
      setModelProvider(detail.conversation.modelProvider)
      setDatabaseType(detail.conversation.databaseType ?? 'postgresql')
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '消息加载失败')
    } finally {
      setLoading(false)
    }
  }, [activeConversationId, showAdmin])

  useEffect(() => {
    // 10 秒轮询用于兜底同步；正在回答的任务由下面的 SSE 实时更新。
    if (!activeConversationId || showAdmin) {
      return
    }
    const initial = window.setTimeout(() => void loadConversation(), 0)
    const poll = window.setInterval(() => void loadConversation(), 10000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(poll)
    }
  }, [activeConversationId, loadConversation, showAdmin])

  const activeTask = useMemo(
    () => tasks.find((task) => task.status === 'queued' || task.status === 'processing'),
    [tasks],
  )
  const activeTaskId = activeTask?.id

  useEffect(() => {
    if (!activeTaskId) return
    console.info('[realtime] SSE connecting', { taskId: activeTaskId })
    const source = new EventSource(tasksApi.eventsUrl(activeTaskId), {
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
        console.info('[realtime] task reached terminal state', {
          taskId: update.id,
          status: update.status,
        })
        source.close()
        void loadConversation()
        void loadConversations()
      }
    })
    source.onerror = () => {
      console.warn('[realtime] SSE disconnected', { taskId: activeTaskId })
      source.close()
    }
    return () => source.close()
  }, [activeTaskId, loadConversation, loadConversations])

  useEffect(() => {
    // 新 token 到达或消息加载后自动滚动到对话底部。
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [tasks])

  function beginNewChat() {
    // 此时只清空本地界面，真正的数据库会话在用户第一次发送时创建。
    setActiveConversationId(null)
    setTasks([])
    setPrompt('')
    setError('')
    setShowAdmin(false)
    setSidebarOpen(false)
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const content = prompt.trim()
    if (!content || submitting || activeTask) return
    setSubmitting(true)
    setError('')
    try {
      let conversationId = activeConversationId
      if (!conversationId) {
        const conversation = await conversationsApi.create(modelProvider, databaseType)
        console.info('[conversation] created', { conversationId: conversation.id })
        conversationId = conversation.id
        setActiveConversationId(conversation.id)
        setConversations((current) => [conversation, ...current])
      }
      const response = await conversationsApi.sendMessage(
        conversationId,
        content,
        modelProvider,
        databaseType,
      )
      console.info('[task] submitted', {
        conversationId,
        taskId: response.task.id,
        provider: modelProvider,
        database: databaseType,
      })
      setTasks((current) => [...current, response.task])
      setConversations((current) => [
        response.conversation,
        ...current.filter((item) => item.id !== response.conversation.id),
      ])
      setPrompt('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '消息发送失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteConversation(
    event: MouseEvent<HTMLButtonElement>,
    conversation: ChatConversation,
  ) {
    event.stopPropagation()
    if (!window.confirm(`确定删除对话“${conversation.title}”吗？\n删除后无法恢复。`)) return

    setDeletingConversationId(conversation.id)
    setError('')
    try {
      await conversationsApi.remove(conversation.id)
      console.info('[conversation] deleted', { conversationId: conversation.id })
      setConversations((current) =>
        current.filter((item) => item.id !== conversation.id),
      )
      if (activeConversationId === conversation.id) {
        setActiveConversationId(null)
        setTasks([])
        setPrompt('')
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '会话删除失败')
    } finally {
      setDeletingConversationId(null)
    }
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 发送，Shift+Enter 保留浏览器默认换行行为。
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  async function logout() {
    try {
      await authApi.logout()
    } finally {
      console.info('[session] logged out')
      setUser(null)
      setConversations([])
      setTasks([])
      setError('')
    }
  }

  function acceptLogin(authenticated: AuthUser) {
    setUser(authenticated)
    setError('')
  }

  if (sessionLoading) {
    return <main className="login-shell"><div className="session-loading">正在验证登录状态…</div></main>
  }
  if (!user) return <LoginScreen message={error} onLogin={acceptLogin} />

  const canCreateTask = user.permissions.includes('tasks:create')
  const canManageUsers = user.permissions.includes('users:manage')
  const activeConversation = conversations.find((item) => item.id === activeConversationId)

  return (
    <main className="chat-app">
      {sidebarOpen && <button className="sidebar-scrim" aria-label="关闭侧栏" onClick={() => setSidebarOpen(false)} type="button" />}
      <aside className={`chat-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">EA</div>
          <strong>Enterprise AI</strong>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} type="button">×</button>
        </div>
        <button className="new-chat-button" onClick={beginNewChat} type="button">
          <span>＋</span> 新对话
        </button>

        <div className="sidebar-label">最近对话</div>
        <nav className="conversation-list" aria-label="会话列表">
          {conversations.length === 0 ? (
            <p className="sidebar-empty">还没有对话</p>
          ) : conversations.map((conversation) => {
            const selected = !showAdmin && conversation.id === activeConversationId
            const deleting = deletingConversationId === conversation.id
            const hasActiveTask = selected && Boolean(activeTask)
            return (
              <div
                className={`conversation-row ${selected ? 'active' : ''}`}
                key={conversation.id}
              >
                <button
                  className="conversation-link"
                  onClick={() => {
                    setShowAdmin(false)
                    setActiveConversationId(conversation.id)
                    setTasks([])
                    setSidebarOpen(false)
                  }}
                  title={conversation.title}
                  type="button"
                >
                  <span className="conversation-icon">◇</span>
                  <span>{conversation.title}</span>
                </button>
                <button
                  aria-label={`删除对话：${conversation.title}`}
                  className="conversation-delete"
                  disabled={deleting || hasActiveTask}
                  onClick={(event) => void deleteConversation(event, conversation)}
                  title={hasActiveTask ? '请等待当前回答完成' : '删除对话'}
                  type="button"
                >
                  {deleting ? '…' : '×'}
                </button>
              </div>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          {canManageUsers && (
            <button
              className={`sidebar-action ${showAdmin ? 'active' : ''}`}
              onClick={() => {
                setShowAdmin(true)
                setTasks([])
                setSidebarOpen(false)
              }}
              type="button"
            >
              <span>⚙</span> 用户与权限
            </button>
          )}
          <div className="account-row">
            <div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div>
            <div><strong>{user.displayName}</strong><small>{user.role === 'admin' ? '管理员' : '普通用户'}</small></div>
            <button className="logout-button" onClick={() => void logout()} title="退出登录" type="button">↪</button>
          </div>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} type="button">☰</button>
          <div className="header-title">
            <strong>{showAdmin ? '用户与权限' : (activeConversation?.title ?? '新对话')}</strong>
            {!showAdmin && <small>{activeTask ? 'AI 正在回答…' : '消息通过企业异步链路安全处理'}</small>}
          </div>
          {!showAdmin && (
            <div className="header-selects">
              <select
                aria-label="选择查询数据库"
                className="database-select"
                disabled={Boolean(activeTask)}
                onChange={(event) => setDatabaseType(event.target.value as DatabaseType)}
                value={databaseType}
              >
                <option value="postgresql">PostgreSQL</option>
                <option value="db2">DB2</option>
              </select>
              <select
                aria-label="选择大模型"
                className="model-select"
                disabled={Boolean(activeTask)}
                onChange={(event) => setModelProvider(event.target.value as ModelProvider)}
                value={modelProvider}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">通义千问</option>
              </select>
            </div>
          )}
        </header>

        {showAdmin ? (
          <div className="admin-view"><AdminUsersPanel currentUserId={user.id} /></div>
        ) : (
          <>
            <div className="messages-scroll">
              <div className="messages-column">
                {!activeConversationId || (tasks.length === 0 && !loading) ? (
                  <div className="chat-welcome">
                    <div className="welcome-mark">EA</div>
                    <h1>今天想聊些什么？</h1>
                    <p>选择 DeepSeek 或通义千问，开始一段可持续的多轮对话。</p>
                    <div className="suggestion-grid">
                      {['总结一份企业文档', '帮我分析一个技术问题', '制定项目实施计划', '解释一段代码'].map((text) => (
                        <button key={text} onClick={() => setPrompt(text)} type="button">{text}</button>
                      ))}
                    </div>
                  </div>
                ) : loading && tasks.length === 0 ? (
                  <div className="chat-loading">正在加载消息…</div>
                ) : tasks.map((task) => {
                  const answer = task.partialText || task.answer || task.result?.text
                  return (
                    <div className="conversation-turn" key={task.id}>
                      <div className="message-row user-message">
                        <div className="message-avatar user-avatar">{user.displayName.slice(0, 1)}</div>
                        <div className="message-content"><div className="message-meta">你</div><div className="message-text">{task.prompt}</div></div>
                      </div>
                      <div className="message-row assistant-message">
                        <div className="message-avatar assistant-avatar">EA</div>
                        <div className="message-content">
                          <div className="message-meta">Enterprise AI <span>{modelLabel(task.modelProvider)} · {databaseLabel(task.databaseType ?? 'postgresql')}{task.modelName ? ` · ${task.modelName}` : ''}</span></div>
                          <div className="message-text assistant-text">
                            {answer || (task.status === 'failed' ? '本次回答失败。' : '正在思考…')}
                            {task.status === 'processing' && <span className="stream-cursor" aria-hidden="true" />}
                          </div>
                          {task.errorMessage && <div className="message-error">{task.errorMessage}</div>}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={messageEndRef} />
              </div>
            </div>

            {canCreateTask && (
              <div className="composer-zone">
                {error && <div className="composer-error" role="alert">{error}</div>}
                <form className="chat-composer" onSubmit={(event) => void submit(event)}>
                  <textarea
                    aria-label="发送消息"
                    disabled={Boolean(activeTask)}
                    maxLength={4000}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={composerKeyDown}
                    placeholder={activeTask ? '请等待当前回答完成…' : '给 Enterprise AI 发送消息'}
                    rows={1}
                    value={prompt}
                  />
                  <button
                    aria-label="发送"
                    className="send-button"
                    disabled={!prompt.trim() || submitting || Boolean(activeTask)}
                    type="submit"
                  >
                    {submitting ? '…' : '↑'}
                  </button>
                </form>
                <small className="composer-hint">Enter 发送，Shift + Enter 换行 · 当前模型：{modelLabel(modelProvider)} · 数据库：{databaseLabel(databaseType)}</small>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}

export default App
