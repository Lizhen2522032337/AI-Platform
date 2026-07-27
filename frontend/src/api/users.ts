import type { ManagedUser } from '../types/auth'
import { request } from './client'

export interface CreateUserPayload {
  username: string
  displayName: string
  password: string
  role: 'admin' | 'user'
}

export const usersApi = {
  list: () => request<ManagedUser[]>('/users'),
  create: (payload: CreateUserPayload) =>
    request<ManagedUser>('/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  update: (
    id: number,
    payload: Partial<Pick<ManagedUser, 'displayName' | 'role' | 'isActive'>>,
  ) =>
    request<ManagedUser>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
}
