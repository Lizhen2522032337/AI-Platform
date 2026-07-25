import type {
  BackendKey,
  BackendOption,
  Item,
  ItemPayload,
} from '../types/item'

export const BACKENDS: BackendOption[] = [
  {
    key: 'fastapi',
    label: 'FastAPI',
    baseUrl: '/api/fastapi',
    description: 'Python · SQLAlchemy',
  },
  {
    key: 'gin',
    label: 'Gin',
    baseUrl: '/api/gin',
    description: 'Go · pgx',
  },
  {
    key: 'nest',
    label: 'NestJS',
    baseUrl: '/api/nest',
    description: 'Node.js · TypeORM',
  },
]

interface ErrorResponse {
  error?: {
    code?: string
    message?: string
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function backendUrl(backend: BackendKey): string {
  const option = BACKENDS.find((candidate) => candidate.key === backend)
  if (!option) {
    throw new Error(`unknown backend: ${backend}`)
  }
  return option.baseUrl
}

async function request<T>(
  backend: BackendKey,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${backendUrl(backend)}${path}`, {
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
      // 非 JSON 错误仍转换为可读的统一异常。
    }
    throw new ApiError(
      body.error?.message ?? `request failed with status ${response.status}`,
      response.status,
      body.error?.code ?? 'REQUEST_FAILED',
    )
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export const itemsApi = {
  list: (backend: BackendKey) => request<Item[]>(backend, '/items'),
  create: (backend: BackendKey, payload: ItemPayload) =>
    request<Item>(backend, '/items', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  update: (backend: BackendKey, id: number, payload: ItemPayload) =>
    request<Item>(backend, `/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  remove: (backend: BackendKey, id: number) =>
    request<void>(backend, `/items/${id}`, { method: 'DELETE' }),
}
