'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

export default function Navbar() {
  const { user, logout, loginWithGithub, appInstallUrl, hasInstallation, activeInstallation, unlinkInstallation } = useAuth();

  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/80 border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            AR
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400">
            Codezy
          </span>
        </Link>

        <nav className="flex items-center space-x-5">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            Dashboard
          </Link>

          {user ? (
            <div className="flex items-center space-x-4">
              {/* Single GitHub App State & Disconnect Action */}
              {hasInstallation ? (
                <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 px-3 py-1 rounded-xl">
                  <span className="flex items-center space-x-1.5 text-emerald-400 text-xs font-semibold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>App Connected</span>
                  </span>
                  <span className="text-slate-700">|</span>
                  <button
                    onClick={() => activeInstallation && unlinkInstallation(activeInstallation.id)}
                    className="text-xs text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <a
                  href={appInstallUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-2 text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-3.5 py-1.5 rounded-xl shadow-md shadow-indigo-500/20 transition-all hover:scale-[1.02]"
                >
                  <span>+ Install GitHub App</span>
                </a>
              )}

              <Link
                href="/profile"
                className="flex items-center space-x-2.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-all text-xs text-slate-200 font-medium"
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    className="w-6 h-6 rounded-full object-cover border border-indigo-500/40"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-bold text-white">
                    {user.username.substring(0, 2).toUpperCase()}
                  </div>
                )}
                <span>@{user.username}</span>
              </Link>

              <button
                onClick={logout}
                className="text-xs text-slate-400 hover:text-rose-400 transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : (
            /* Single Unified GitHub Button when unauthenticated */
            <button
              onClick={loginWithGithub}
              className="flex items-center space-x-2 text-xs font-semibold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white px-4 py-2 rounded-xl shadow-lg shadow-indigo-500/20 transition-all transform hover:scale-[1.02]"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              <span>Connect with GitHub</span>
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

