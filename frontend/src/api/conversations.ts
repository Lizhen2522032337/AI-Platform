import type {
  ChatConversation,
  ConversationDetail,
  SendMessageResponse,
} from '../types/conversation'
import type { ModelProvider } from '../types/task'
import { request } from './client'

export const conversationsApi = {
  list: () => request<ChatConversation[]>('/conversations'),
  create: (modelProvider: ModelProvider) =>
    request<ChatConversation>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ modelProvider }),
    }),
  detail: (id: number) => request<ConversationDetail>(`/conversations/${id}`),
  sendMessage: (id: number, content: string, modelProvider: ModelProvider) =>
    request<SendMessageResponse>(`/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, modelProvider }),
    }),
}
