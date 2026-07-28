import type { AiTask, ModelProvider } from './task'

export interface ChatConversation {
  id: number
  title: string
  modelProvider: ModelProvider
  createdById: number
  createdAt: string
  updatedAt: string
}

export interface ConversationDetail {
  conversation: ChatConversation
  tasks: AiTask[]
}

export interface SendMessageResponse {
  conversation: ChatConversation
  task: AiTask
}
