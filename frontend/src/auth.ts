export interface AuthConfig {
  enabled: boolean;
  type?: 'foss' | 'supabase';
  supabase_enabled?: boolean;
  supabase_url?: string;
  supabase_anon_key?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  default_unit: 'm' | 'mm' | 'ft' | 'in';
}

export interface AuthSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user: UserProfile;
}

const STORAGE_KEY = 'planvault_auth_session';
const ENV = (import.meta as any).env || {};
export const API_BASE = (ENV.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function getStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession | null): void {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(apiUrl('/api/auth/config'));
    if (res.ok) {
      const data = await res.json();
      return {
        enabled: true,
        type: data.type || 'foss',
        supabase_enabled: Boolean(data.supabase_enabled),
        supabase_url: data.supabase_url || '',
        supabase_anon_key: data.supabase_anon_key || '',
      };
    }
  } catch {
    // fallback
  }
  return {
    enabled: true,
    type: 'foss',
  };
}

export async function signInWithEmail(
  cfg: AuthConfig,
  email: string,
  password: string
): Promise<AuthSession> {
  const res = await fetch(apiUrl('/api/auth/signin'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.message || 'Invalid email or password');
  }
  const session: AuthSession = {
    access_token: data.access_token,
    user: {
      id: data.user?.id,
      email: data.user?.email || email,
      default_unit: data.user?.default_unit || 'm',
    },
  };
  saveSession(session);
  return session;
}

export async function signUpWithEmail(
  cfg: AuthConfig,
  email: string,
  password: string
): Promise<{ session: AuthSession | null; confirmationRequired: boolean }> {
  const res = await fetch(apiUrl('/api/auth/signup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.message || 'Sign up failed');
  }
  const session: AuthSession = {
    access_token: data.access_token,
    user: {
      id: data.user?.id,
      email: data.user?.email || email,
      default_unit: data.user?.default_unit || 'm',
    },
  };
  saveSession(session);
  return { session, confirmationRequired: false };
}

export async function fetchUserProfile(): Promise<UserProfile | null> {
  const session = getStoredSession();
  if (!session?.access_token) return null;
  try {
    const res = await authFetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      const updatedUser: UserProfile = {
        id: data.id,
        email: data.email,
        default_unit: data.default_unit || 'm',
      };
      saveSession({ ...session, user: updatedUser });
      return updatedUser;
    }
  } catch {
    // ignore
  }
  return session.user;
}

export async function updateUserProfile(default_unit: 'm' | 'mm' | 'ft' | 'in'): Promise<UserProfile> {
  const res = await authFetch('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ default_unit }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Failed to update preferences');
  }
  const session = getStoredSession();
  const updatedUser: UserProfile = {
    id: data.id,
    email: data.email,
    default_unit: data.default_unit || default_unit,
  };
  if (session) {
    saveSession({ ...session, user: updatedUser });
  }
  return updatedUser;
}

export async function signOutSession(cfg?: AuthConfig): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('planvault_supabase_session');
}

export function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = getStoredSession();
  const headers = new Headers(init.headers || {});
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(apiUrl(path), { ...init, headers });
}
