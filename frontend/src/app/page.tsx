'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

export default function LandingPage() {
  const { user, appInstallUrl, loginWithGithub, hasInstallation } = useAuth();


  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      {/* Hero Section */}
      <section className="text-center space-y-6 py-12">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
          <span>✨ Multi-Agent Autonomous PR Reviewer</span>
        </div>
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-tight">
          AI Code Review That Actually <br />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
            Understands Your Codebase
          </span>
        </h1>
        <p className="text-lg md:text-xl text-slate-400 max-w-3xl mx-auto font-normal">
          Parallel Style &amp; Security Agents audit every PR diff in seconds, outputting clear severity scores and direct GitHub PR markdown comments.
        </p>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-center gap-4">
          {!user ? (
            <button
              onClick={loginWithGithub}
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all transform hover:-translate-y-0.5 flex items-center justify-center space-x-3"
            >
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              <span>Connect with GitHub</span>
            </button>
          ) : !hasInstallation ? (
            <a
              href={appInstallUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all transform hover:-translate-y-0.5 flex items-center justify-center space-x-2"
            >
              <span>+ Install GitHub App</span>
            </a>
          ) : (
            <Link
              href="/profile"
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all transform hover:-translate-y-0.5 flex items-center justify-center space-x-2"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Manage Connected Repositories →</span>
            </Link>
          )}

          <Link
            href="/dashboard"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:bg-slate-800/80 text-slate-300 font-semibold transition-all"
          >
            Live Dashboard
          </Link>
        </div>

      </section>

      {/* Feature Cards */}
      <section className="grid md:grid-cols-3 gap-8 py-16">
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm space-y-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 text-xl font-bold">
            🛡️
          </div>
          <h3 className="text-xl font-semibold text-white">Security Scan Agent</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Checks diffs for hardcoded API keys, SQL injection risks, unsafe evaluation calls, and missing validation.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm space-y-3">
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 text-xl font-bold">
            🎨
          </div>
          <h3 className="text-xl font-semibold text-white">Style &amp; Best Practices Agent</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Evaluates variable naming, formatting consistency, and repo architectural conventions using RAG context.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm space-y-3">
          <div className="w-12 h-12 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 text-xl font-bold">
            ⚡
          </div>
          <h3 className="text-xl font-semibold text-white">Real-Time WebSocket Stream</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Watch agents execute live on the WebSocket-powered dashboard as BullMQ workers process incoming webhooks.
          </p>
        </div>
      </section>
    </div>
  );
}
