import type { AiTask, ModelProvider } from '../types/task'
import { request } from './client'

export const tasksApi = {
  list: () => request<AiTask[]>('/tasks'),
  create: (prompt: string, modelProvider: ModelProvider) =>
    request<AiTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt, modelProvider }),
    }),
  eventsUrl: (taskId: number) => `/realtime/events/${taskId}`,

}
