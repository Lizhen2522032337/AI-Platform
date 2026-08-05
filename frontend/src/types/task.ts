export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type ModelProvider = 'deepseek' | 'qwen'
export type DatabaseType = 'postgresql' | 'db2'
export type TraceStepStatus = 'running' | 'completed' | 'failed' | 'skipped'

export interface ExecutionTraceStep {
  id: string
  title: string
  detail?: string
  kind: 'stage' | 'tool'
  status: TraceStepStatus
  toolName?: string
  durationMs?: number
}

export interface TaskArtifact {
  name: string
  kind: 'report' | 'query_workbook' | 'evidence' | 'query_data' | string
  objectKey: string
  contentType: string
  size: number
}

export interface AiTask {
  id: number
  prompt: string
  status: TaskStatus
  modelProvider: ModelProvider
  databaseType: DatabaseType
  modelName: string | null
  answer: string | null
  partialText?: string
  result: {
    taskId?: number
    text?: string
    vectorId?: string
    objectKey?: string
    artifacts?: TaskArtifact[]
    executionTrace?: ExecutionTraceStep[]
  } | null
  executionTrace?: ExecutionTraceStep[]
  errorMessage: string | null
  objectKey: string | null
  vectorId: string | null
  createdById: number | null
  conversationId: number | null
  createdAt: string
  updatedAt: string
}

export interface TaskEvent {
  id: number
  status: TaskStatus
  modelProvider?: ModelProvider
  modelName?: string
  partialText?: string
  result?: AiTask['result']
  errorMessage?: string
  executionTrace?: ExecutionTraceStep[]
}
