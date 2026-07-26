import Link from 'next/link';

export default function LandingPage() {
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
          <a
            href="https://github.com/apps/autoreview-bot/installations/new"
            target="_blank"
            rel="noreferrer"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all transform hover:-translate-y-0.5"
          >
            Install GitHub App
          </a>
          <Link
            href="/dashboard"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 font-semibold transition-all"
          >
            View Live Dashboard
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
