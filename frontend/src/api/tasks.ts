import type { AiTask, DatabaseType, ModelProvider } from '../types/task'
import { request } from './client'

export const tasksApi = {
  list: () => request<AiTask[]>('/tasks'),
  create: (
    prompt: string,
    modelProvider: ModelProvider,
    databaseType: DatabaseType = 'postgresql',
  ) =>
    request<AiTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt, modelProvider, databaseType }),
    }),
  eventsUrl: (taskId: number) => `/realtime/events/${taskId}`,

}
