// Signed-in staff member + permissions for the admin app.
// The API enforces every permission; this only decides what to show.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { markActive } from './idle';

const AuthContext = createContext(null);
const RANK = { none: 0, view: 1, manage: 2 };

// Which CMS module each top-level path belongs to (menus, guards and the view-only notice).
export const MODULE_PATHS = {
  bookings: '/bookings',
  profiles: '/profiles',
  locations: '/locations',
  content: '/content',
  seo: '/seo',
  inquiries: '/inquiries',
  settings: '/settings',
  users: '/users',
  audit: '/audit',
};
export const moduleForPath = (pathname) => {
  const first = `/${pathname.split('/')[1] || ''}`;
  if (first === '/roles') return 'users';
  if (first === '/live-chat') return 'inquiries';
  return Object.entries(MODULE_PATHS).find(([, p]) => p === first)?.[0] || null;
};

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, setup: null, error: '' });

  const refresh = useCallback(async () => {
    try {
      const [{ user }, setup] = await Promise.all([api.get('/admin/auth/me'), api.get('/admin/auth/setup')]);
      setState({ loading: false, user, setup, error: '' });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const expired = () => setState((s) => ({ ...s, user: null, expired: !!s.user }));
    const mustChange = () => setState((s) => (s.user ? { ...s, user: { ...s.user, mustChangePassword: true } } : s));
    window.addEventListener('auth:expired', expired);
    window.addEventListener('auth:password-change', mustChange);
    return () => {
      window.removeEventListener('auth:expired', expired);
      window.removeEventListener('auth:password-change', mustChange);
    };
  }, []);

  const signedIn = (user) => {
    markActive();
    setState((s) => ({ ...s, user, setup: { ...s.setup, needed: false }, expired: false }));
  };
  const login = async (email, password, remember) => signedIn((await api.post('/admin/auth/login', { email, password, remember })).user);
  const setupFirstAdmin = async (body) => signedIn((await api.post('/admin/auth/setup', body)).user);
  const changePassword = async (currentPassword, newPassword) => signedIn((await api.post('/admin/auth/password', { currentPassword, newPassword })).user);
  const signOut = async (expired) => {
    await api.post('/admin/auth/logout').catch(() => {});
    setState((s) => ({ ...s, user: null, expired }));
  };
  const logout = () => signOut(false);
  const idleLogout = () => signOut('idle');
  const can = useCallback((module, level = 'view') => !!state.user && RANK[state.user.permissions?.[module] || 'none'] >= RANK[level], [state.user]);

  return (
    <AuthContext.Provider value={{ ...state, refresh, login, logout, idleLogout, setupFirstAdmin, changePassword, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
