interface ErrorResponse {
  error?: { code?: string; message?: string }
  message?: string
}

export class ApiError extends Error {
  // 保留 HTTP 状态和后端业务码，页面可按需做更细的错误处理。
  readonly status: number
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

export async function request<T>(
  path: string,
  init?: RequestInit,
  suppressUnauthorizedEvent = false,
): Promise<T> {
  // 所有业务接口统一经过 Nginx 的 /api 前缀；Cookie 由浏览器自动携带。
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    let body: ErrorResponse = {}
    try {
      body = (await response.json()) as ErrorResponse
    } catch {
      // 非 JSON 响应使用状态码构造错误。
    }
    if (response.status === 401 && !suppressUnauthorizedEvent) {
      // 让顶层 App 统一退出，避免各组件分别维护过期逻辑。
      window.dispatchEvent(new Event('auth:expired'))
    }
    throw new ApiError(
      body.error?.message ?? body.message ?? `请求失败：${response.status}`,
      response.status,
      body.error?.code,
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
