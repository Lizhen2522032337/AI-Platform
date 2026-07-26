export type BackendKey = 'fastapi' | 'gin' | 'nest'

export interface BackendOption {
  key: BackendKey
  label: string
  baseUrl: string
  description: string
}
export interface Item {
  id: number
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface ItemPayload {
  name: string
  description: string
}
