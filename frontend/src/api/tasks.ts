import type { AiTask } from '../types/task'
import { request } from './client'

export const tasksApi = {
  list: () => request<AiTask[]>('/tasks'),
  create: (prompt: string) =>
    request<AiTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
  eventsUrl: (taskId: number) => `/realtime/events/${taskId}`,

}
