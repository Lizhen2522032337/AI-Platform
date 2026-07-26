export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface AiTask {
  id: number
  prompt: string
  status: TaskStatus
  result: {
    taskId?: number
    text?: string
    vectorId?: string
    objectKey?: string
  } | null
  errorMessage: string | null
  objectKey: string | null
  vectorId: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskEvent {
  id: number
  status: TaskStatus
  result?: AiTask['result']
  errorMessage?: string
}
