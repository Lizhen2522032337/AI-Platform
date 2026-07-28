export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type ModelProvider = 'deepseek' | 'qwen'

export interface AiTask {
  id: number
  prompt: string
  status: TaskStatus
  modelProvider: ModelProvider
  modelName: string | null
  answer: string | null
  partialText?: string
  result: {
    taskId?: number
    text?: string
    vectorId?: string
    objectKey?: string
  } | null
  errorMessage: string | null
  objectKey: string | null
  vectorId: string | null
  createdById: number | null
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
}
