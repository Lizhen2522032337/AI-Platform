import type { AiTask } from '../types/task'

interface ErrorResponse {
  error?: { code?: string; message?: string }
  message?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
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
    throw new Error(
      body.error?.message ?? body.message ?? `请求失败：${response.status}`,
    )
  }
  return (await response.json()) as T
}

export const tasksApi = {
  list: () => request<AiTask[]>('/tasks'),
  create: (prompt: string) =>
    request<AiTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
  eventsUrl: (taskId: number) => `/realtime/events/${taskId}`,

}
  console.log('tasksApi', tasksApi)
