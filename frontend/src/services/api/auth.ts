// Authentication API functions
import { API_ENDPOINTS } from '@/constants';
import { getToken, setToken, setUser, clearAuth, type AuthUser } from '@/utils/auth';

interface LoginResponse {
  token: string;
  user: AuthUser;
}

interface MeResponse {
  username: string;
  tenant: string;
}

/**
 * Login with username and password
 */
export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await fetch(API_ENDPOINTS.AUTH_LOGIN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(error.error || 'Login failed');
  }

  const data: LoginResponse = await response.json();
  setToken(data.token);
  setUser(data.user);
  return data.user;
}

/**
 * Get current user info
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await fetch(API_ENDPOINTS.AUTH_ME, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        clearAuth();
      }
      return null;
    }

    const data: MeResponse = await response.json();
    return {
      username: data.username,
      tenant: data.tenant,
    };
  } catch {
    return null;
  }
}

/**
 * Logout
 */
export function logout(): void {
  clearAuth();
}
