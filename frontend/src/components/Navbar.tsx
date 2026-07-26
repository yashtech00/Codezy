import Link from 'next/link';

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/80 border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            AR
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400">
            AutoReview
          </span>
        </Link>

        <nav className="flex items-center space-x-6">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            Dashboard
          </Link>
          <a
            href="https://github.com/apps/autoreview-bot/installations/new"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-4 py-2 rounded-lg shadow-md shadow-indigo-500/20 transition-all hover:scale-[1.02]"
          >
            Install GitHub App
          </a>
        </nav>
      </div>
    </header>
  );
}
