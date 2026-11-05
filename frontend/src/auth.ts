export interface AuthConfig {
  enabled: boolean;
  supabase_url: string;
  supabase_anon_key: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user: {
    id: string;
    email?: string;
  };
}

const STORAGE_KEY = 'planvault_supabase_session';
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
  const envUrl = (ENV.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const envKey = (ENV.VITE_SUPABASE_ANON_KEY || '').trim();
  try {
    const res = await fetch(apiUrl('/api/auth/config'));
    if (res.ok) {
      const data = await res.json();
      const url = data.supabase_url || envUrl;
      const key = data.supabase_anon_key || envKey;
      return {
        enabled: Boolean(data.enabled || (url && key)),
        supabase_url: url,
        supabase_anon_key: key,
      };
    }
  } catch {
    // Fallback to Vite env if backend is unreachable
  }
  return {
    enabled: Boolean(envUrl && envKey),
    supabase_url: envUrl,
    supabase_anon_key: envKey,
  };
}

export async function consumeUrlHashSession(cfg: AuthConfig): Promise<AuthSession | null> {
  if (!window.location.hash.includes('access_token=') || !cfg.supabase_url) return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token') || undefined;
  const expiresIn = Number(params.get('expires_in') || 3600);
  if (!accessToken) return null;

  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
  const res = await fetch(`${cfg.supabase_url}/auth/v1/user`, {
    headers: {
      apikey: cfg.supabase_anon_key,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  const user = await res.json();
  const session: AuthSession = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: { id: user.id, email: user.email },
  };
  saveSession(session);
  return session;
}

export async function ensureFreshSession(cfg: AuthConfig): Promise<AuthSession | null> {
  const session = getStoredSession();
  if (!session) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (!session.expires_at || session.expires_at - nowSec > 60) {
    return session;
  }
  if (!session.refresh_token || !cfg.supabase_url || !cfg.supabase_anon_key) {
    return session;
  }
  try {
    const res = await fetch(`${cfg.supabase_url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: cfg.supabase_anon_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) {
      saveSession(null);
      return null;
    }
    const data = await res.json();
    const refreshed: AuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || session.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
      user: { id: data.user?.id || session.user.id, email: data.user?.email || session.user.email },
    };
    saveSession(refreshed);
    return refreshed;
  } catch {
    return session;
  }
}

export async function signInWithEmail(
  cfg: AuthConfig,
  email: string,
  password: string
): Promise<AuthSession> {
  const res = await fetch(`${cfg.supabase_url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabase_anon_key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.msg || data.error_description || data.message || 'Invalid email or password');
  }
  const session: AuthSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    user: { id: data.user?.id, email: data.user?.email || email },
  };
  saveSession(session);
  return session;
}

export async function signUpWithEmail(
  cfg: AuthConfig,
  email: string,
  password: string
): Promise<{ session: AuthSession | null; confirmationRequired: boolean }> {
  const res = await fetch(`${cfg.supabase_url}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabase_anon_key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.msg || data.error_description || data.message || 'Sign up failed');
  }
  if (data.access_token && data.user?.id) {
    const session: AuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
      user: { id: data.user.id, email: data.user.email || email },
    };
    saveSession(session);
    return { session, confirmationRequired: false };
  }
  return { session: null, confirmationRequired: true };
}

export async function signOutSession(cfg: AuthConfig): Promise<void> {
  const session = getStoredSession();
  saveSession(null);
  if (session?.access_token && cfg.supabase_url && cfg.supabase_anon_key) {
    try {
      await fetch(`${cfg.supabase_url}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: cfg.supabase_anon_key,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
    } catch {
      // Ignore network errors on logout
    }
  }
}

export function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = getStoredSession();
  const headers = new Headers(init.headers || {});
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(apiUrl(path), { ...init, headers });
}

