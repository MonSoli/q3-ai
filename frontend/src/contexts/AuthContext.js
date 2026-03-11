import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { registerUser, loginUser, fetchMe, refreshToken } from "../utils/authApi";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("qwen3_token"));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const u = await fetchMe(token);
        setUser(u);
      } catch {
        const rt = localStorage.getItem("qwen3_refresh_token");
        if (rt) {
          try {
            const data = await refreshToken(rt);
            localStorage.setItem("qwen3_token", data.token);
            localStorage.setItem("qwen3_refresh_token", data.refresh_token);
            setToken(data.token);
            const u = await fetchMe(data.token);
            setUser(u);
          } catch {
            setToken(null);
            localStorage.removeItem("qwen3_token");
            localStorage.removeItem("qwen3_refresh_token");
          }
        } else {
          setToken(null);
          localStorage.removeItem("qwen3_token");
        }
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await loginUser(email, password);
    localStorage.setItem("qwen3_token", data.token);
    localStorage.setItem("qwen3_refresh_token", data.refresh_token);
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  const register = useCallback(async (email, password) => {
    const data = await registerUser(email, password);
    localStorage.setItem("qwen3_token", data.token);
    localStorage.setItem("qwen3_refresh_token", data.refresh_token);
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("qwen3_token");
    localStorage.removeItem("qwen3_refresh_token");
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
