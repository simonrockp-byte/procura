import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('procura_user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('procura_token'));

  const login = useCallback(async (orgSlug, email, password) => {
    const data = await api.post('/api/auth/login', {
      org_slug: orgSlug, email, password,
    });
    localStorage.setItem('procura_token', data.token);
    localStorage.setItem('procura_user', JSON.stringify(data.officer));
    setToken(data.token);
    setUser(data.officer);
    return data.officer;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('procura_token');
    localStorage.removeItem('procura_user');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthed: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
