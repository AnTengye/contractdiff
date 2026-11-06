// Authentication API functions
import { API_ENDPOINTS } from '@/constants';
import { getToken, setToken, setUser, clearAuth, type AuthUser } from '@/utils/auth';

interface LoginResponse {
  token: string;
  user?: AuthUser;
  username?: string;
  tenant?: string;
}

interface MeResponse {
  username: string;
  tenant: string;
  can_review_feedback?: boolean;
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
  const user = data.user ?? { username: data.username ?? username, tenant: data.tenant ?? '' };
  setUser(user);
  return user;
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
      can_review_feedback: data.can_review_feedback ?? false,
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
