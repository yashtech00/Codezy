'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';

export default function ProfilePage() {
  const { user, installations, loading, logout, unlinkInstallation, appInstallUrl, loginWithGithub, demoLogin } = useAuth();
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleUnlink = async (id: string, repoCount: number) => {
    if (!confirm(`Are you sure you want to disconnect this GitHub App installation (${repoCount} repository monitored)?`)) {
      return;
    }

    setUnlinkingId(id);
    setFeedbackMsg(null);
    const success = await unlinkInstallation(id);
    setUnlinkingId(null);

    if (success) {
      setFeedbackMsg({ type: 'success', text: 'GitHub App installation disconnected successfully.' });
    } else {
      setFeedbackMsg({ type: 'error', text: 'Failed to disconnect installation.' });
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-slate-400">Loading user profile &amp; installations...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 text-3xl mx-auto">
          🔐
        </div>
        <h1 className="text-3xl font-bold text-white">Sign in to Manage Codezy</h1>
        <p className="text-slate-400 max-w-lg mx-auto">
          Connect your GitHub account to manage installed repositories, view multi-agent PR review dashboards, and configure security rules.
        </p>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={loginWithGithub}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold border border-slate-700 shadow-lg flex items-center justify-center space-x-3 transition-all"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <span>Connect with GitHub</span>

          </button>

          <button
            onClick={() => demoLogin('yashtech00')}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-semibold border border-indigo-500/30 transition-all text-sm"
          >
            ⚡ Quick Demo Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-10">
      {/* Profile Header */}
      <div className="p-8 rounded-3xl bg-slate-900/80 border border-slate-800 backdrop-blur-md flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-xl">
        <div className="flex items-center space-x-5">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="w-20 h-20 rounded-2xl border-2 border-indigo-500/40 shadow-lg object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-indigo-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
              {user.username.substring(0, 2).toUpperCase()}
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-white">{user.name || user.username}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                Connected
              </span>
            </div>
            <p className="text-sm text-slate-400 font-mono">@{user.username}</p>
            {user.email && <p className="text-xs text-slate-500">{user.email}</p>}
          </div>
        </div>

        <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
          <Link
            href="/dashboard"
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-all border border-slate-700"
          >
            Live Dashboard
          </Link>

          <button
            onClick={logout}
            className="px-5 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-sm font-semibold border border-rose-500/20 transition-all"
          >
            Sign Out
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div
          className={`p-4 rounded-xl text-sm font-medium border ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
          }`}
        >
          {feedbackMsg.text}
        </div>
      )}

      {/* GitHub App Installations Section */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white">Connected Repositories &amp; GitHub App</h2>
            <p className="text-sm text-slate-400">
              Manage GitHub App installations monitoring your pull requests.
            </p>
          </div>

          <a
            href={appInstallUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center space-x-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-semibold shadow-lg shadow-indigo-500/20 transition-all"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <span>+ Add / Install GitHub App</span>
          </a>
        </div>

        {installations.length === 0 ? (
          <div className="p-12 text-center rounded-3xl bg-slate-900/40 border border-slate-800 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-2xl mx-auto text-slate-400">
              📦
            </div>
            <h3 className="text-lg font-semibold text-white">No GitHub App Installations Linked</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Install the Codezy AutoReview GitHub App on your repositories to automatically run parallel security &amp; style agents on pull requests.
            </p>
            <a
              href={appInstallUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-all"
            >
              Install Codezy App on GitHub
            </a>
          </div>
        ) : (
          <div className="grid gap-6">
            {installations.map((inst) => {
              const repoList = Array.isArray(inst.repoList) ? (inst.repoList as string[]) : [];
              return (
                <div
                  key={inst.id}
                  className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-sm flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-slate-700 transition-all shadow-md"
                >
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <span className="text-lg font-semibold text-white">
                        {inst.accountUsername || 'GitHub Account'}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        ID: {inst.githubInstallationId}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          inst.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                            : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                        }`}
                      >
                        {inst.status}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                        Monitored Repositories ({repoList.length})
                      </p>
                      {repoList.length > 0 ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {repoList.map((repo) => (
                            <span
                              key={repo}
                              className="px-2.5 py-1 rounded-lg text-xs font-mono bg-slate-800 border border-slate-700/60 text-slate-300"
                            >
                              {repo}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">All repositories or list pending webhook synchronization</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0 pt-4 md:pt-0 border-t md:border-t-0 border-slate-800">
                    <a
                      href={`https://github.com/settings/installations/${inst.githubInstallationId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all border border-slate-700"
                    >
                      Manage on GitHub ↗
                    </a>

                    <button
                      onClick={() => handleUnlink(inst.id, repoList.length)}
                      disabled={unlinkingId === inst.id}
                      className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold border border-rose-500/20 transition-all disabled:opacity-50"
                    >
                      {unlinkingId === inst.id ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Webhook & Ngrok Configuration Helper */}
      <div className="p-6 rounded-2xl bg-indigo-950/30 border border-indigo-800/40 space-y-4">
        <div className="flex items-center space-x-2 text-indigo-400 font-semibold text-sm">
          <span>🌐</span>
          <span>GitHub App Webhook &amp; Ngrok Integration Setup</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          To receive pull request events and installation webhooks locally, point your GitHub App&apos;s Webhook URL to your active ngrok HTTP tunnel (Port 8000).
        </p>
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 flex items-center justify-between overflow-x-auto">
          <span>Webhook Endpoint URL: <strong className="text-indigo-400">https://&lt;your-ngrok-domain&gt;/webhook/github</strong></span>
        </div>
      </div>
    </div>
  );
}
