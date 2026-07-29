import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface AgentRun {
  id: string;
  agentType: string;
  status: string;
  findingsJson?: any;
}

interface Review {
  id: string;
  prNumber: number;
  repoFullName: string;
  headSha: string;
  status: string;
  severityScore?: number;
  summary?: string;
  agentSummary?: Record<string, number>;
  createdAt: string;
  agentRuns: AgentRun[];
}

async function getReviews(): Promise<Review[]> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    const res = await fetch(`${apiUrl}/api/reviews`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.reviews || [];
  } catch (error) {
    console.error('Failed to fetch reviews:', error);
    return [];
  }
}

// Agent type → color mapping
const AGENT_COLORS: Record<string, string> = {
  GIT_HYGIENE: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  SECURITY:    'bg-red-500/10 text-red-400 border border-red-500/20',
  LOGIC:       'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  PERFORMANCE: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  TESTING:     'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
  STYLE:       'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
  JUDGE:       'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
};

const AGENT_EMOJIS: Record<string, string> = {
  GIT_HYGIENE: '🔑',
  SECURITY:    '🔒',
  LOGIC:       '🧩',
  PERFORMANCE: '⚡',
  TESTING:     '🧪',
  STYLE:       '🎨',
  JUDGE:       '⚖️',
};

// Severity score → color class
function getSeverityColor(score?: number) {
  if (score === undefined || score === null) return 'text-slate-500';
  if (score >= 7) return 'text-red-400 font-bold';
  if (score >= 4) return 'text-amber-400 font-bold';
  return 'text-emerald-400 font-bold';
}

function getSeverityBg(score?: number) {
  if (score === undefined || score === null) return '';
  if (score >= 7) return 'bg-red-500/5 border-red-500/20';
  if (score >= 4) return 'bg-amber-500/5 border-amber-500/20';
  return 'bg-emerald-500/5 border-emerald-500/20';
}

export default async function DashboardPage() {
  const reviews = await getReviews();

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-10">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">PR Review Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            Multi-agent AI security, logic, performance & style audits — real-time.
          </p>
        </div>
        {/* Agent legend */}
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(AGENT_EMOJIS).map(([type, emoji]) => (
            <span
              key={type}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${AGENT_COLORS[type] || ''}`}
            >
              {emoji} {type.replace('_', ' ')}
            </span>
          ))}
        </div>
      </div>

      {/* Review Table */}
      <div className="rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-semibold text-white">Recent Pull Request Reviews</h2>
          <span className="text-xs text-slate-400">{reviews.length} Total Reviews</span>
        </div>

        {reviews.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-4xl">🔍</div>
            <h3 className="text-lg font-semibold text-slate-200">No PR Reviews Found Yet</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Install the Codezy GitHub App or trigger a mock PR review to see live agent results here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/80 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4">Repository & PR</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Severity</th>
                  <th className="px-6 py-4">Agents Run</th>
                  <th className="px-6 py-4">Findings</th>
                  <th className="px-6 py-4">Created At</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {reviews.map((rev) => {
                  const totalFindings = rev.agentSummary
                    ? Object.values(rev.agentSummary).reduce((s, n) => s + n, 0)
                    : rev.agentRuns?.reduce(
                        (s, ar) =>
                          s + (Array.isArray(ar.findingsJson) ? ar.findingsJson.length : 0),
                        0
                      ) ?? 0;

                  return (
                    <tr key={rev.id} className="hover:bg-slate-800/40 transition-colors">
                      {/* Repo + PR number */}
                      <td className="px-6 py-4 font-mono font-medium text-white">
                        {rev.repoFullName}{' '}
                        <span className="text-indigo-400">#{rev.prNumber}</span>
                      </td>

                      {/* Status badge */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase ${
                            rev.status === 'COMPLETED'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : rev.status === 'RUNNING'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                              : rev.status === 'FAILED'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                          }`}
                        >
                          {rev.status}
                        </span>
                      </td>

                      {/* Severity score with color */}
                      <td className={`px-6 py-4`}>
                        {rev.severityScore !== undefined && rev.severityScore !== null ? (
                          <span className={`font-mono text-base ${getSeverityColor(rev.severityScore)}`}>
                            {rev.severityScore}/10
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>

                      {/* Agent badges */}
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {rev.agentRuns && rev.agentRuns.length > 0 ? (
                            rev.agentRuns.map((ar) => (
                              <span
                                key={ar.id}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                                  AGENT_COLORS[ar.agentType] ||
                                  'bg-slate-800 border border-slate-700 text-slate-300'
                                }`}
                              >
                                {AGENT_EMOJIS[ar.agentType] || '🤖'} {ar.agentType}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-500 text-xs">Queued</span>
                          )}
                        </div>
                      </td>

                      {/* Total findings */}
                      <td className="px-6 py-4">
                        {totalFindings > 0 ? (
                          <span className="font-mono font-semibold text-slate-200">
                            {totalFindings}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs">—</span>
                        )}
                      </td>

                      {/* Created at */}
                      <td className="px-6 py-4 text-slate-400 text-xs font-mono">
                        {new Date(rev.createdAt).toLocaleString()}
                      </td>

                      {/* Action */}
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/dashboard/${rev.id}`}
                          className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          View Stream →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
