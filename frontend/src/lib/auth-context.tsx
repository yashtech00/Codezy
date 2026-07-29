"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface User {
  id: string;
  githubId: number;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface Installation {
  id: string;
  githubInstallationId: number;
  accountUsername: string | null;
  accountType: string | null;
  status: string;
  repoList: string[];
  planType: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: User | null;
  installations: Installation[];
  hasInstallation: boolean;
  activeInstallation: Installation | null;
  loading: boolean;
  token: string | null;
  appInstallUrl: string;
  loginWithGithub: () => Promise<void>;
  demoLogin: (username?: string) => Promise<void>;
  logout: () => void;
  unlinkInstallation: (id: string) => Promise<boolean>;
  refreshUser: (authToken?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [token, setToken] = useState<string | null>(null);
  const [appInstallUrl, setAppInstallUrl] = useState<string>(
    "https://github.com/apps/codezyautoreview/installations/new",
  );


  const activeInstallations = installations.filter((i) => i.status === "ACTIVE");
  const hasInstallation = activeInstallations.length > 0;
  const activeInstallation = activeInstallations[0] || null;

  const refreshUser = async (authToken?: string) => {
    const activeToken =
      authToken ||
      token ||
      (typeof window !== "undefined"
        ? localStorage.getItem("codezy_token")
        : null);
    if (!activeToken) {
      setUser(null);
      setInstallations([]);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${activeToken}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setInstallations(data.installations || []);
        if (data.appInstallUrl) {
          setAppInstallUrl(data.appInstallUrl);
        }
        setToken(activeToken);
      } else if (res.status === 401) {
        // Access Token expired (15m) -> Try silent refresh with Refresh Token (7d)
        const savedRefreshToken = typeof window !== "undefined" ? localStorage.getItem("codezy_refresh_token") : null;
        if (savedRefreshToken) {
          const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: savedRefreshToken }),
          });

          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            localStorage.setItem("codezy_token", refreshData.token);
            if (refreshData.refreshToken) {
              localStorage.setItem("codezy_refresh_token", refreshData.refreshToken);
            }
            setToken(refreshData.token);
            return refreshUser(refreshData.token);
          }
        }
        // If refresh token fails or does not exist
        localStorage.removeItem("codezy_token");
        localStorage.removeItem("codezy_refresh_token");
        setToken(null);
        setUser(null);
        setInstallations([]);
      } else {
        localStorage.removeItem("codezy_token");
        localStorage.removeItem("codezy_refresh_token");
        setToken(null);
        setUser(null);
        setInstallations([]);
      }
    } catch (err) {
      console.error("Failed to fetch current user:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const savedToken = localStorage.getItem("codezy_token");
    if (savedToken) {
      setToken(savedToken);
      refreshUser(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const loginWithGithub = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/github/url`);
      const data = await res.json();

      if (data.configured && data.url) {
        window.location.href = data.url;
      } else {
        // Fallback demo login if GitHub OAuth Client ID is not configured yet
        await demoLogin("yashtech00");
      }
    } catch (err) {
      console.error("Failed to initiate GitHub login:", err);
      await demoLogin("yashtech00");
    }
  };

  const demoLogin = async (username = "yashtech00") => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/auth/demo-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("codezy_token", data.token);
        if (data.refreshToken) {
          localStorage.setItem("codezy_refresh_token", data.refreshToken);
        }
        setToken(data.token);
        await refreshUser(data.token);
      }
    } catch (err) {
      console.error("Demo login error:", err);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("codezy_token");
    localStorage.removeItem("codezy_refresh_token");
    setToken(null);
    setUser(null);
    setInstallations([]);
  };

  const unlinkInstallation = async (id: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch(`${API_BASE}/api/installations/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        setInstallations((prev) => prev.filter((inst) => inst.id !== id));
        return true;
      }
    } catch (err) {
      console.error("Failed to unlink installation:", err);
    }
    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        installations,
        hasInstallation,
        activeInstallation,
        loading,
        token,
        appInstallUrl,
        loginWithGithub,
        demoLogin,
        logout,
        unlinkInstallation,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}


export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
