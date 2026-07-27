import type { AuthUser, LoginResponse } from '../types/auth'
import { request } from './client'

export const authApi = {
  login: (username: string, password: string) =>
    request<LoginResponse>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      },
      true,
    ),
  me: () => request<AuthUser>('/auth/me', undefined, true),
  logout: () => request<void>('/auth/logout', { method: 'POST' }, true),
}
