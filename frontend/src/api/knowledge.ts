import type { KnowledgeDocument, KnowledgeVisibility } from '../types/knowledge'
import { request } from './client'

export const knowledgeApi = {
  list: () => request<KnowledgeDocument[]>('/knowledge/documents'),
  upload: (title: string, visibility: KnowledgeVisibility, file: File) => {
    const body = new FormData()
    body.append('title', title)
    body.append('visibility', visibility)
    body.append('file', file)
    return request<KnowledgeDocument>('/knowledge/documents', { method: 'POST', body })
  },
  updateVisibility: (id: number, visibility: KnowledgeVisibility) =>
    request<KnowledgeDocument>(`/knowledge/documents/${id}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    }),
  delete: (id: number) =>
    request<void>(`/knowledge/documents/${id}`, { method: 'DELETE' }),
}
