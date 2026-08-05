// =============================================================================
// App.tsx — 企业 AI 异步任务控制台主组件
// =============================================================================
// 本文件是 React 前端的唯一页面级组件，承载了登录、会话列表、对话消息、
// 模型/数据库选择、管理员用户面板等所有界面逻辑。
//
// 架构概览：
//   - 认证：JWT 通过 HttpOnly Cookie 传递，React 不持有 token，只持有用户公开信息。
//   - 会话：左侧 sidebar 展示会话列表，右侧主区域展示当前会话的问答轮次。
//   - 实时更新：优先使用 Gin 的 SSE（Server-Sent Events）推送，10 秒轮询作为兜底。
//   - 后端链路：React → Nginx → NestJS(接收请求) → RabbitMQ(任务队列) → Worker(消费任务)
//               → FastAPI(AI 推理) → Gin(通过 Redis 推送 SSE 状态)。
// =============================================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { authApi } from "./api/auth";
import { conversationsApi } from "./api/conversations";
import { tasksApi } from "./api/tasks";
import { AdminUsersPanel } from "./components/AdminUsersPanel";
import { ExecutionTrace } from "./components/ExecutionTrace";
import { LoginScreen } from "./components/LoginScreen";
import type { AuthUser } from "./types/auth";
import type { ChatConversation } from "./types/conversation";
import type {
  AiTask,
  DatabaseType,
  ModelProvider,
  TaskEvent,
} from "./types/task";
import "./App.css";

// ---------------------------------------------------------------------------
// 工具函数：将后端枚举值映射为中文显示文本
// ---------------------------------------------------------------------------

/**
 * 将模型提供商的 code 转换为中文显示名称。
 * 后端只接受稳定的 provider code（deepseek / qwen），中文名称仅用于界面展示。
 */
function modelLabel(provider: ModelProvider) {
  return provider === "qwen" ? "通义千问" : "DeepSeek";
}

/**
 * 将数据库类型的 code 转换为显示名称。
 */
function databaseLabel(databaseType: DatabaseType) {
  return databaseType === "db2" ? "DB2" : "PostgreSQL";
}

function App() {
  // ===========================================================================
  // 状态定义
  // ===========================================================================

  // --- 认证相关状态 ---
  // sessionLoading: 页面初始化时先展示"验证登录状态"的 loading 界面，
  //   直到 /auth/me 返回结果后才决定展示登录页还是主界面。
  const [sessionLoading, setSessionLoading] = useState(true);
  // user: 当前登录用户的公开信息（id、用户名、角色、权限列表等）。
  //   JWT token 本身存在 HttpOnly Cookie 中，JS 无法读取，安全性更高。
  //   null 表示未登录或登录已过期。
  const [user, setUser] = useState<AuthUser | null>(null);

  // --- 会话与消息状态 ---
  // conversations: 左侧 sidebar 展示的会话列表，按最近更新时间降序排列。
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  // activeConversationId: 右侧主区域当前展示的会话 ID。null 表示"新对话"占位界面。
  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null);
  // tasks: 当前会话中的所有问答轮次（一问一答为一轮）。
  //   每轮包含用户 prompt 和 AI answer，以及状态（排队/处理中/完成/失败）。
  const [tasks, setTasks] = useState<AiTask[]>([]);
  // prompt: 底部输入框的当前文本内容。
  const [prompt, setPrompt] = useState("");

  // --- 对话配置选项（随会话持久化） ---
  // modelProvider: 当前会话使用的 LLM 模型提供商，首次对话时持久化到数据库。
  const [modelProvider, setModelProvider] = useState<ModelProvider>("deepseek");
  // databaseType: 当前会话的数据源类型。DB2 暂不可用时仍保留选项，后端返回明确错误。
  const [databaseType, setDatabaseType] = useState<DatabaseType>("postgresql");

  // --- 界面状态 ---
  // loading: 加载会话消息时为 true，显示"正在加载消息…"。
  const [loading, setLoading] = useState(false);
  // submitting: 提交新消息时为 true，发送按钮显示"…"并禁用。
  const [submitting, setSubmitting] = useState(false);
  // deletingConversationId: 正在删除的会话 ID，用于显示删除按钮的"…"状态。
  const [deletingConversationId, setDeletingConversationId] = useState<
    number | null
  >(null);
  // downloadingArtifactKey: 正在下载的“任务ID:产物序号”，用于避免重复点击。
  const [downloadingArtifactKey, setDownloadingArtifactKey] = useState<
    string | null
  >(null);
  // error: 全局错误提示信息，显示在底部输入栏上方。
  const [error, setError] = useState("");
  // showAdmin: true 时右侧主区域切换到管理员用户面板。
  const [showAdmin, setShowAdmin] = useState(false);
  // sidebarOpen: 移动端侧栏的开关状态。
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // messageEndRef: 消息列表底部的哨兵 div，新消息到达后自动滚动到此处。
  const messageEndRef = useRef<HTMLDivElement>(null);

  // ===========================================================================
  // Effect：页面初始化 — 恢复登录状态
  // ===========================================================================
  // 应用启动时调用 /auth/me，通过 HttpOnly Cookie 验证 JWT 是否有效。
  // 成功 → 设置 user 对象，进入主界面。
  // 失败 → user 保持 null，渲染 LoginScreen。
  // 不会在 localStorage 存储 token，避免 XSS 窃取风险。
  useEffect(() => {
    authApi
      .me()
      .then((authenticated) => {
        console.info("[session] restored", {
          userId: authenticated.id,
          role: authenticated.role,
        });
        setUser(authenticated);
      })
      .catch(() => {
        console.info("[session] no active login");
        setUser(null);
      })
      .finally(() => setSessionLoading(false));
  }, []);

  // ===========================================================================
  // Effect：监听全局 401 事件 — 统一处理登录过期
  // ===========================================================================
  // API 客户端（api/auth.ts）在收到 401 响应时触发 auth:expired 自定义事件。
  // 所有需要清理状态的逻辑集中在此处，避免散落在各个 API 调用中。
  // useEffect 依赖项为空数组，确保只绑定一次事件监听器。
  useEffect(() => {
    const expire = () => {
      console.warn("[session] expired or revoked");
      setUser(null);
      setConversations([]);
      setTasks([]);
      setError("登录已过期，请重新登录。");
    };
    window.addEventListener("auth:expired", expire);
    return () => window.removeEventListener("auth:expired", expire);
  }, []);

  // ===========================================================================
  // 数据加载函数
  // ===========================================================================

  /**
   * 加载会话列表。
   * 仅在用户已登录时调用。加载后自动维护 activeConversationId：
   * 如果当前活跃会话仍在列表中则保持，否则选中第一个会话，列表为空则置 null。
   */
  const loadConversations = useCallback(async () => {
    if (!user) return;
    try {
      const items = await conversationsApi.list();
      console.info("[conversation] list loaded", { count: items.length });
      setConversations(items);
      setActiveConversationId((current) =>
        current && items.some((item) => item.id === current)
          ? current
          : (items[0]?.id ?? null),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "会话加载失败",
      );
    }
  }, [user]);

  // loadConversations 首次加载：用 setTimeout(fn, 0) 延迟到当前渲染帧之后执行，
  // 避免在 React 严格模式下与渲染冲突。
  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations]);

  /**
   * 加载当前会话的所有消息（tasks）。
   * 加载时会将新数据与当前内存中的 liveTask 合并，保留 SSE 推送的 partialText 和
   * executionTrace，避免轮询覆盖实时数据。
   * showAdmin 为 true 时不加载（因为主区域展示的是管理员面板，非对话界面）。
   */
  const loadConversation = useCallback(async () => {
    if (!activeConversationId || showAdmin) return;
    setLoading(true);
    try {
      const detail = await conversationsApi.detail(activeConversationId);
      console.info("[conversation] detail loaded", {
        conversationId: activeConversationId,
        turns: detail.tasks.length,
      });
      // 合并策略：保留当前 live 状态中 SSE 推送的 partialText 和 executionTrace
      setTasks((current) =>
        detail.tasks.map((task) => {
          const liveTask = current.find((item) => item.id === task.id);
          return {
            ...task,
            // 轮询发现任务已经结束时，丢弃内存中的旧增量文本。
            partialText:
              task.status === "queued" || task.status === "processing"
                ? liveTask?.partialText
                : undefined,
            executionTrace:
              liveTask?.executionTrace ?? task.result?.executionTrace,
          };
        }),
      );
      setModelProvider(detail.conversation.modelProvider);
      setDatabaseType(detail.conversation.databaseType ?? "postgresql");
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "消息加载失败",
      );
    } finally {
      setLoading(false);
    }
  }, [activeConversationId, showAdmin]);

  // ===========================================================================
  // Effect：轮询刷新 — 10 秒间隔拉取会话消息（SSE 的兜底机制）
  // ===========================================================================
  // 首次加载用 setTimeout(0) 立即触发，之后每 10 秒轮询一次。
  // SSE 负责实时推送流式 token 和执行轨迹，轮询负责纠正因网络异常导致的遗漏。
  // 切换到管理员面板或无活跃会话时停止轮询。
  useEffect(() => {
    if (!activeConversationId || showAdmin) {
      return;
    }
    const initial = window.setTimeout(() => void loadConversation(), 0);
    const poll = window.setInterval(() => void loadConversation(), 10000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
    };
  }, [activeConversationId, loadConversation, showAdmin]);

  // ===========================================================================
  // 实时状态跟踪（SSE + 计算属性）
  // ===========================================================================

  /**
   * 当前会话中正在排队或处理中的任务（同一时间最多一个）。
   * 用于判断是否禁用输入框、发送按钮，以及显示"正在回答"状态。
   */
  const activeTask = useMemo(
    () =>
      tasks.find(
        (task) => task.status === "queued" || task.status === "processing",
      ),
    [tasks],
  );
  // activeTaskId: 提取 activeTask 的 ID，作为 SSE 连接的依赖项。
  // 当任务完成/失败后变为 null → SSE 自动断开。
  const activeTaskId = activeTask?.id;

  // ===========================================================================
  // Effect：SSE 实时连接 — 接收 Gin 推送的任务状态和流式文本
  // ===========================================================================
  // 后端流程：Gin 轮询 Redis 最新状态，当 Worker 更新任务状态时，
  // Gin 通过 SSE 将状态变更推送到前端。相比纯轮询，SSE 延迟更低、带宽更省。
  //
  // 推送字段包括：
  //   - status: 任务状态变更（queued → processing → completed/failed）
  //   - partialText: Worker 调用 FastAPI 产生的流式 token
  //   - executionTrace: 后端调用链的可视化步骤（查询耗时、AI 调用等）
  //   - result: 任务完成后 FastAPI 返回的完整结果
  //
  // 到达终态（completed 或 failed）时关闭连接并触发全量刷新，
  // 确保轮询拿到最终数据库状态。
  useEffect(() => {
    if (!activeTaskId) return;
    console.info("[realtime] SSE connecting", { taskId: activeTaskId });
    const source = new EventSource(tasksApi.eventsUrl(activeTaskId), {
      withCredentials: true, // 携带 Cookie 用于 SSE 端点的 JWT 验证
    });
    source.addEventListener("task", (event) => {
      const update = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as TaskEvent;
      // 按 task.id 定位并合并增量更新，只修改当前活跃任务不覆盖其他轮次
      setTasks((current) =>
        current.map((task) =>
          task.id === update.id
            ? {
                ...task,
                status: update.status,
                modelName: update.modelName ?? task.modelName,
                // 只有任务执行中才保留增量文本；完成后改用完整回答。
                partialText:
                  update.status === "queued" || update.status === "processing"
                    ? (update.partialText ?? task.partialText)
                    : undefined,
                result: update.result ?? task.result,
                answer: update.result?.text ?? task.answer,
                errorMessage: update.errorMessage ?? task.errorMessage,
                executionTrace:
                  update.executionTrace ??
                  update.result?.executionTrace ??
                  task.executionTrace,
              }
            : task,
        ),
      );
      if (update.status === "completed" || update.status === "failed") {
        console.info("[realtime] task reached terminal state", {
          taskId: update.id,
          status: update.status,
        });
        source.close();
        // 任务终结后全量刷新，确保 UI 与数据库一致
        void loadConversation();
        void loadConversations();
      }
    });
    source.onerror = () => {
      console.warn("[realtime] SSE disconnected", { taskId: activeTaskId });
      source.close();
      // 异常断开不重连，依赖轮询兜底恢复数据
    };
    return () => source.close();
  }, [activeTaskId, loadConversation, loadConversations]);

  // ===========================================================================
  // Effect：自动滚动 — 新消息到达后滚动到对话底部
  // ===========================================================================
  // tasks 数组变化（新任务提交、SSE 推送 partialText、轮询更新）时触发。
  // 使用 smooth 平滑滚动，block: 'end' 确保最新消息完整可见。
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [tasks]);

  // ===========================================================================
  // 用户交互处理函数
  // ===========================================================================

  /**
   * 开始新对话。
   * 清空右侧主区域的所有本地状态，此时不创建数据库会话。
   * 真正的会话记录在用户首次发送消息时由后端创建（懒创建策略）。
   */
  function beginNewChat() {
    setActiveConversationId(null);
    setTasks([]);
    setPrompt("");
    setError("");
    setShowAdmin(false);
    setSidebarOpen(false);
  }

  /**
   * 提交消息到当前会话。
   *
   * 懒创建策略：
   *   1. activeConversationId 为 null → 先调用 POST /conversations 创建新会话
   *   2. 然后调用 POST /conversations/:id/messages 发送消息
   *
   * 提交前检查：
   *   - prompt 不能为空
   *   - 不能在 submitting 状态（防重复提交）
   *   - 不能在 activeTask 状态（上一个任务尚未完成）
   *
   * 提交后将新 task 追加到 tasks 列表，并由 SSE 接管后续状态更新。
   */
  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = prompt.trim();
    if (!content || submitting || activeTask) return;
    setSubmitting(true);
    setError("");
    try {
      let conversationId = activeConversationId;
      // 懒创建：如果没有活跃会话，先创建一个新会话
      if (!conversationId) {
        const conversation = await conversationsApi.create(
          modelProvider,
          databaseType,
        );
        console.info("[conversation] created", {
          conversationId: conversation.id,
        });
        conversationId = conversation.id;
        setActiveConversationId(conversation.id);
        setConversations((current) => [conversation, ...current]);
      }
      // 发送消息并获取后台已分配的任务 ID
      const response = await conversationsApi.sendMessage(
        conversationId,
        content,
        modelProvider,
        databaseType,
      );
      console.info("[task] submitted", {
        conversationId,
        taskId: response.task.id,
        provider: modelProvider,
        database: databaseType,
      });
      // 追加新任务到列表（状态为 queued），SSE 随后推送实时状态更新
      setTasks((current) => [...current, response.task]);
      // 更新会话列表排序（新消息的会话排到最前）
      setConversations((current) => [
        response.conversation,
        ...current.filter((item) => item.id !== response.conversation.id),
      ]);
      setPrompt("");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "消息发送失败",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteConversation(
    event: MouseEvent<HTMLButtonElement>,
    conversation: ChatConversation,
  ) {
    event.stopPropagation(); // 阻止冒泡，避免同时触发会话切换
    if (
      !window.confirm(
        `确定删除对话\u201c${conversation.title}\u201d吗？\n删除后无法恢复。`,
      )
    )
      return;

    setDeletingConversationId(conversation.id);
    setError("");
    try {
      await conversationsApi.remove(conversation.id);
      console.info("[conversation] deleted", {
        conversationId: conversation.id,
      });
      setConversations((current) =>
        current.filter((item) => item.id !== conversation.id),
      );
      if (activeConversationId === conversation.id) {
        setActiveConversationId(null);
        setTasks([]);
        setPrompt("");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "会话删除失败",
      );
    } finally {
      setDeletingConversationId(null);
    }
  }

  async function downloadArtifact(
    taskId: number,
    artifactIndex: number,
    fileName: string,
  ) {
    const key = `${taskId}:${artifactIndex}`;
    setDownloadingArtifactKey(key);
    setError("");
    try {
      await tasksApi.downloadArtifact(taskId, artifactIndex, fileName);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "文件下载失败",
      );
    } finally {
      setDownloadingArtifactKey(null);
    }
  }

  /**
   * 输入框键盘事件处理。
   *   - Enter（不加 Shift）：发送消息
   *   - Shift + Enter：浏览器默认行为 → 换行
   */
  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 发送，Shift+Enter 保留浏览器默认换行行为。
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  /**
   * 退出登录。
   * 调用后端 /auth/logout 清除 HttpOnly Cookie，然后清空所有本地状态。
   * finally 代码块确保即使网络请求失败也清空 UI（防止状态不一致）。
   */
  async function logout() {
    try {
      await authApi.logout();
    } finally {
      console.info("[session] logged out");
      setUser(null);
      setConversations([]);
      setTasks([]);
      setError("");
    }
  }

  /**
   * 登录成功回调。由 LoginScreen 子组件在用户凭据验证通过后调用。
   * 将后端返回的用户信息写入 state，触发从登录界面到主界面的切换。
   */
  function acceptLogin(authenticated: AuthUser) {
    setUser(authenticated);
    setError("");
  }

  // ===========================================================================
  // 条件渲染：三种顶层状态
  // ===========================================================================

  // 状态 1：正在验证 Cookie 登录态 → 显示加载界面
  if (sessionLoading) {
    return (
      <main className="login-shell">
        <div className="session-loading">正在验证登录状态…</div>
      </main>
    );
  }
  // 状态 2：未登录 → 显示登录页面
  if (!user) return <LoginScreen message={error} onLogin={acceptLogin} />;

  // 状态 3：已登录 → 显示主界面
  // 权限位提前计算，用于控制管理员按钮和任务提交按钮的显隐
  const canCreateTask = user.permissions.includes("tasks:create");
  const canManageUsers = user.permissions.includes("users:manage");
  const activeConversation = conversations.find(
    (item) => item.id === activeConversationId,
  );

  return (
    <main className="chat-app">
      {/* 移动端：侧栏展开时的半透明遮罩，点击关闭侧栏 */}
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭侧栏"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      )}

      {/* ========== 左侧栏：会话列表 + 用户信息 ========== */}
      <aside className={`chat-sidebar ${sidebarOpen ? "open" : ""}`}>
        {/* 品牌标识行 */}
        <div className="brand-row">
          <div className="brand-mark">EA</div>
          <strong>Enterprise AI</strong>
          <button
            className="icon-button mobile-only"
            onClick={() => setSidebarOpen(false)}
            type="button"
          >
            ×
          </button>
        </div>
        {/* 新对话按钮 — 清空主区域，不立即创建数据库记录 */}
        <button
          className="new-chat-button"
          onClick={beginNewChat}
          type="button"
        >
          <span>＋</span> 新对话
        </button>

        {/* 会话列表（按最近更新时间降序） */}
        <div className="sidebar-label">最近对话</div>
        <nav className="conversation-list" aria-label="会话列表">
          {conversations.length === 0 ? (
            <p className="sidebar-empty">还没有对话</p>
          ) : (
            conversations.map((conversation) => {
              const selected =
                !showAdmin && conversation.id === activeConversationId;
              const deleting = deletingConversationId === conversation.id;
              // 当前活跃会话中有正在处理的任务时，禁止删除
              const hasActiveTask = selected && Boolean(activeTask);
              return (
                <div
                  className={`conversation-row ${selected ? "active" : ""}`}
                  key={conversation.id}
                >
                  {/* 会话切换按钮 */}
                  <button
                    className="conversation-link"
                    onClick={() => {
                      setShowAdmin(false);
                      setActiveConversationId(conversation.id);
                      setTasks([]); // 先清空旧消息，触发 loadConversation 重新拉取
                      setSidebarOpen(false);
                    }}
                    title={conversation.title}
                    type="button"
                  >
                    <span className="conversation-icon">◇</span>
                    <span>{conversation.title}</span>
                  </button>
                  {/* 删除按钮：处理中或正在删除时禁用 */}
                  <button
                    aria-label={`删除对话：${conversation.title}`}
                    className="conversation-delete"
                    disabled={deleting || hasActiveTask}
                    onClick={(event) =>
                      void deleteConversation(event, conversation)
                    }
                    title={hasActiveTask ? "请等待当前回答完成" : "删除对话"}
                    type="button"
                  >
                    {deleting ? "…" : "×"}
                  </button>
                </div>
              );
            })
          )}
        </nav>

        {/* 侧栏底部：管理员入口 + 当前用户信息 + 退出登录 */}
        <div className="sidebar-footer">
          {canManageUsers && (
            <button
              className={`sidebar-action ${showAdmin ? "active" : ""}`}
              onClick={() => {
                setShowAdmin(true);
                setTasks([]);
                setSidebarOpen(false);
              }}
              type="button"
            >
              <span>⚙</span> 用户与权限
            </button>
          )}
          <div className="account-row">
            <div className="avatar">
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>{user.displayName}</strong>
              <small>{user.role === "admin" ? "管理员" : "普通用户"}</small>
            </div>
            <button
              className="logout-button"
              onClick={() => void logout()}
              title="退出登录"
              type="button"
            >
              ↪
            </button>
          </div>
        </div>
      </aside>

      {/* ========== 右侧主区域：对话消息 / 管理员面板 ========== */}
      <section className="chat-main">
        {/* 顶部标题栏：移动端菜单按钮 + 会话标题 + 模型/数据库选择器 */}
        <header className="chat-header">
          <button
            className="icon-button mobile-only"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            ☰
          </button>
          <div className="header-title">
            <strong>
              {showAdmin
                ? "用户与权限"
                : (activeConversation?.title ?? "新对话")}
            </strong>
            {!showAdmin && (
              <small>
                {activeTask ? "AI 正在回答…" : "消息通过企业异步链路安全处理"}
              </small>
            )}
          </div>
          {/* 非管理员模式下显示模型和数据库选择器；任务处理中禁用切换 */}
          {!showAdmin && (
            <div className="header-selects">
              <select
                aria-label="选择查询数据库"
                className="database-select"
                disabled={Boolean(activeTask)}
                onChange={(event) =>
                  setDatabaseType(event.target.value as DatabaseType)
                }
                value={databaseType}
              >
                <option value="postgresql">PostgreSQL</option>
                <option value="db2">DB2</option>
              </select>
              <select
                aria-label="选择大模型"
                className="model-select"
                disabled={Boolean(activeTask)}
                onChange={(event) =>
                  setModelProvider(event.target.value as ModelProvider)
                }
                value={modelProvider}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">通义千问</option>
              </select>
            </div>
          )}
        </header>

        {/* showAdmin 为 true → 渲染管理员面板 */}
        {showAdmin ? (
          <div className="admin-view">
            <AdminUsersPanel currentUserId={user.id} />
          </div>
        ) : (
          <>
            {/* 消息滚动区域 */}
            <div className="messages-scroll">
              <div className="messages-column">
                {/* 情况 A：新对话或空会话 → 欢迎界面 + 快捷提问建议 */}
                {!activeConversationId || (tasks.length === 0 && !loading) ? (
                  <div className="chat-welcome">
                    <div className="welcome-mark">EA</div>
                    <h1>今天想聊些什么？</h1>
                    <p>选择 DeepSeek 或通义千问，开始一段可持续的多轮对话。</p>
                    <div className="suggestion-grid">
                      {[
                        "总结一份企业文档",
                        "帮我分析一个技术问题",
                        "制定项目实施计划",
                        "解释一段代码",
                      ].map((text) => (
                        <button
                          key={text}
                          onClick={() => setPrompt(text)}
                          type="button"
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : loading && tasks.length === 0 ? (
                  /* 情况 B：正在加载消息 → loading 占位 */
                  <div className="chat-loading">正在加载消息…</div>
                ) : (
                  tasks.map((task) => {
                    /* 情况 C：有消息 → 渲染一问一答的对话轮次 */
                    // answer 优先取 SSE 推送的 partialText，其次是数据库中已入库的 answer，最后取 result.text
                    // 执行中优先展示流式文本；任务结束后只展示最终完整回答。
                    const answer =
                      task.status === "queued" || task.status === "processing"
                        ? task.partialText || task.answer || task.result?.text
                        : task.answer || task.result?.text;
                    return (
                      <div className="conversation-turn" key={task.id}>
                        {/* 用户消息 */}
                        <div className="message-row user-message">
                          <div className="message-avatar user-avatar">
                            {user.displayName.slice(0, 1)}
                          </div>
                          <div className="message-content">
                            <div className="message-meta">你</div>
                            <div className="message-text">{task.prompt}</div>
                          </div>
                        </div>
                        {/* AI 回复 */}
                        <div className="message-row assistant-message">
                          <div className="message-avatar assistant-avatar">
                            EA
                          </div>
                          <div className="message-content">
                            <div className="message-meta">
                              Enterprise AI{" "}
                              <span>
                                {modelLabel(task.modelProvider)} ·{" "}
                                {databaseLabel(
                                  task.databaseType ?? "postgresql",
                                )}
                                {task.modelName ? ` · ${task.modelName}` : ""}
                              </span>
                            </div>
                            {/* 执行轨迹：展示后端调用链的每一步（查询字段、调用 FastAPI、耗时等） */}
                            <ExecutionTrace
                              status={task.status}
                              steps={
                                task.executionTrace ??
                                task.result?.executionTrace ??
                                []
                              }
                            />
                            {/* AI 回答文本 / 失败提示 / 生成中占位 */}
                            {(answer ||
                              task.status === "failed" ||
                              task.status === "processing") && (
                              <div className="message-text assistant-text">
                                {answer ||
                                  (task.status === "failed"
                                    ? "本次回答失败。"
                                    : "正在生成回答…")}
                                {/* SSE 推送进行中时显示闪烁光标，模拟打字效果 */}
                                {task.status === "processing" && (
                                  <span
                                    className="stream-cursor"
                                    aria-hidden="true"
                                  />
                                )}
                              </div>
                            )}
                            {task.errorMessage && (
                              <div className="message-error">
                                {task.errorMessage}
                              </div>
                            )}
                            {task.status === "completed" &&
                              task.result?.artifacts &&
                              task.result.artifacts.length > 0 && (
                                <div className="artifact-downloads">
                                  <div className="artifact-downloads-title">
                                    <span>可下载文件</span>
                                    <small>
                                      {task.result.artifacts.length} 个
                                    </small>
                                  </div>
                                  <div className="artifact-download-list">
                                    {task.result.artifacts.map(
                                      (artifact, artifactIndex) => {
                                        const key = `${task.id}:${artifactIndex}`;
                                        const downloading =
                                          downloadingArtifactKey === key;
                                        return (
                                          <button
                                            className="artifact-download-button"
                                            disabled={
                                              downloadingArtifactKey !== null
                                            }
                                            key={`${artifact.objectKey}:${artifactIndex}`}
                                            onClick={() =>
                                              void downloadArtifact(
                                                task.id,
                                                artifactIndex,
                                                artifact.name,
                                              )
                                            }
                                            title={`下载 ${artifact.name}`}
                                            type="button"
                                          >
                                            <span aria-hidden="true">↓</span>
                                            <span>{artifact.name}</span>
                                            <small>
                                              {downloading ? "下载中…" : "下载"}
                                            </small>
                                          </button>
                                        );
                                      },
                                    )}
                                  </div>
                                </div>
                              )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {/* 滚动哨兵：新消息到达后自动滚动到此 div */}
                <div ref={messageEndRef} />
              </div>
            </div>

            {/* 底部输入区域：仅 tasks:create 权限用户可见 */}
            {canCreateTask && (
              <div className="composer-zone">
                {error && (
                  <div className="composer-error" role="alert">
                    {error}
                  </div>
                )}
                <form
                  className="chat-composer"
                  onSubmit={(event) => void submit(event)}
                >
                  <textarea
                    aria-label="发送消息"
                    disabled={Boolean(activeTask)}
                    maxLength={4000}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={composerKeyDown}
                    placeholder={
                      activeTask
                        ? "请等待当前回答完成…"
                        : "给 Enterprise AI 发送消息"
                    }
                    rows={1}
                    value={prompt}
                  />
                  <button
                    aria-label="发送"
                    className="send-button"
                    disabled={
                      !prompt.trim() || submitting || Boolean(activeTask)
                    }
                    type="submit"
                  >
                    {submitting ? "…" : "↑"}
                  </button>
                </form>
                <small className="composer-hint">
                  Enter 发送，Shift + Enter 换行 · 当前模型：
                  {modelLabel(modelProvider)} · 数据库：
                  {databaseLabel(databaseType)}
                </small>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export default App;
