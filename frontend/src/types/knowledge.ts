export type KnowledgeVisibility = 'public' | 'admin'
export type KnowledgeStatus = 'processing' | 'ready' | 'failed'

export interface KnowledgeDocument {
  id: number
  title: string
  originalFilename: string
  contentType: string
  visibility: KnowledgeVisibility
  status: KnowledgeStatus
  fileSize: string
  chunkCount: number
  errorMessage: string | null
  createdById: number
  createdAt: string
  updatedAt: string
}
