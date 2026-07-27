export interface AuthUser {
  id: number
  username: string
  displayName: string
  role: 'admin' | 'user' | string
  permissions: string[]
}

export interface LoginResponse {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
  user: AuthUser
}

export interface ManagedUser extends AuthUser {
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}
