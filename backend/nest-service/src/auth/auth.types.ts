export interface AuthenticatedUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
  tokenVersion: number;
}

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: string;
  permissions: string[];
  ver: number;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: Omit<AuthenticatedUser, 'tokenVersion'>;
}
