// 后端统一返回的错误响应体结构。
// 后端可能以 { error: { code, message } } 或 { message } 两种格式返回错误信息。
interface ErrorResponse {
  error?: { code?: string; message?: string }
  message?: string
}

// 自定义 API 错误类，封装 HTTP 状态码和后端业务错误码。
// 组件可通过 catch 捕获此错误，按 status 或 code 做差异化处理。
export class ApiError extends Error {
  // HTTP 状态码（如 400、401、403、500）
  readonly status: number
  // 后端业务错误码（如 "TOKEN_EXPIRED"、"PERMISSION_DENIED"），可选
  readonly code?: string

  constructor(
    message: string,
    status: number,
    code?: string,
  ) {
    super(message)
    this.status = status
    this.code = code
  }
}

// 通用请求函数，所有 API 调用都通过此函数统一发送。
// 负责添加 /api 前缀、携带 Cookie、解析响应、处理 401 等通用错误。
//
// @param path           - 接口路径（不含 /api 前缀），如 "/auth/me"
// @param init           - 可选的 fetch 配置（method、body 等）
// @param suppressUnauthorizedEvent - 为 true 时不触发全局 401 事件（登录接口本身返回 401 时不应触发退出）
// @returns              解析后的 JSON 响应体
export async function request<T>(
  path: string,
  init?: RequestInit,
  suppressUnauthorizedEvent = false,
): Promise<T> {
  const hasFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  // 统一添加 /api 前缀，经过 Nginx 反向代理到各后端服务。
  // Cookie（含 JWT）由浏览器自动携带，JS 无法读取，防 XSS。
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin', // 同源请求自动携带 Cookie
    headers: {
      Accept: 'application/json',
      ...(init?.body && !hasFormData ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  // ---------- 非 2xx 响应：统一错误处理 ----------
  if (!response.ok) {
    let body: ErrorResponse = {}
    try {
      body = (await response.json()) as ErrorResponse
    } catch {
      // 响应体不是 JSON（如 Nginx 返回的 502 HTML 页面），
      // body 保持空对象，后续用状态码生成默认错误消息。
    }

    // 401 未授权 → 触发全局 auth:expired 事件，由 App.tsx 统一清理状态并提示重新登录。
    if (response.status === 401 && !suppressUnauthorizedEvent) {
      window.dispatchEvent(new Event('auth:expired'))
    }

    // 优先使用后端返回的错误消息，其次用状态码生成兜底消息。
    throw new ApiError(
      body.error?.message ?? body.message ?? `请求失败：${response.status}`,
      response.status,
      body.error?.code,
    )
  }

  // 204 No Content：响应体为空，直接返回 undefined。
  if (response.status === 204) return undefined as T

  // 正常响应：解析 JSON 并返回。
  return (await response.json()) as T
}

/**
 * 下载受登录保护的二进制文件，并使用后端记录的友好文件名保存。
 */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/octet-stream' },
  })
  if (!response.ok) {
    let body: ErrorResponse = {}
    try {
      body = (await response.json()) as ErrorResponse
    } catch {
      // 文件服务异常时可能返回非 JSON 响应，继续使用状态码构造错误。
    }
    if (response.status === 401) {
      window.dispatchEvent(new Event('auth:expired'))
    }
    throw new ApiError(
      body.error?.message ?? body.message ?? `文件下载失败：${response.status}`,
      response.status,
      body.error?.code,
    )
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
