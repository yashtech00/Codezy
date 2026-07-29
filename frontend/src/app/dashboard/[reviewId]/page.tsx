import LiveAgentStatus from '@/components/LiveAgentStatus';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Finding {
  file: string;
  line: number;
  issue: string;
  severity: string;
  category?: string;
}

interface AgentRun {
  id: string;
  agentType: string;
  status: string;
  findingsJson?: Finding[];
  startedAt?: string;
  completedAt?: string;
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

async function getReview(reviewId: string): Promise<Review | null> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const res = await fetch(`${apiUrl}/api/reviews/${reviewId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.review || null;
  } catch (error) {
    console.error('Failed to fetch review detail:', error);
    return null;
  }
}

const AGENT_META: Record<string, { emoji: string; label: string; color: string; bg: string }> = {
  GIT_HYGIENE: { emoji: '🔑', label: 'Git Hygiene & Secrets',    color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
  SECURITY:    { emoji: '🔒', label: 'Security Vulnerabilities', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
  LOGIC:       { emoji: '🧩', label: 'Logic & Correctness',      color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  PERFORMANCE: { emoji: '⚡', label: 'Performance',              color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
  TESTING:     { emoji: '🧪', label: 'Test Coverage',            color: 'text-cyan-400',   bg: 'bg-cyan-500/10 border-cyan-500/20' },
  STYLE:       { emoji: '🎨', label: 'Style & Code Quality',     color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20' },
  JUDGE:       { emoji: '⚖️',  label: 'Judge (Verified)',         color: 'text-emerald-400',bg: 'bg-emerald-500/10 border-emerald-500/20' },
};

const SEVERITY_META: Record<string, { label: string; dot: string; text: string }> = {
  CRITICAL: { label: '🚨 CRITICAL', dot: 'bg-red-500',    text: 'text-red-400' },
  HIGH:     { label: '🔴 HIGH',     dot: 'bg-red-400',    text: 'text-red-400' },
  MEDIUM:   { label: '🟡 MEDIUM',   dot: 'bg-amber-400',  text: 'text-amber-400' },
  LOW:      { label: '🟢 LOW',      dot: 'bg-emerald-400',text: 'text-emerald-400' },
};

function getSeverityScoreColor(score?: number) {
  if (score === undefined || score === null) return 'text-slate-400';
  if (score >= 7) return 'text-red-400';
  if (score >= 4) return 'text-amber-400';
  return 'text-emerald-400';
}

export default async function ReviewDetailPage({
  params,
}: {
  params: { reviewId: string };
}) {
  const review = await getReview(params.reviewId);

  if (!review) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-20 text-center space-y-4">
        <h1 className="text-2xl font-bold text-white">PR Review Not Found</h1>
        <p className="text-slate-400">The requested review ID does not exist or has expired.</p>
        <Link href="/dashboard" className="inline-block text-sm text-indigo-400 hover:underline">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  // Group all findings by category across agent runs
  const findingsByCategory: Record<string, Finding[]> = {};
  const CATEGORY_ORDER = ['GIT_HYGIENE', 'SECURITY', 'LOGIC', 'PERFORMANCE', 'TESTING', 'STYLE'];

  review.agentRuns?.forEach((ar) => {
    if (ar.agentType === 'JUDGE' || !Array.isArray(ar.findingsJson)) return;
    const cat = ar.agentType;
    if (!findingsByCategory[cat]) findingsByCategory[cat] = [];
    findingsByCategory[cat].push(...ar.findingsJson);
  });

  const totalFindings = Object.values(findingsByCategory).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-8">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-xs text-indigo-400 hover:underline">
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-extrabold text-white mt-2">
            {review.repoFullName}{' '}
            <span className="text-indigo-400">#{review.prNumber}</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">
            SHA: {review.headSha} · {new Date(review.createdAt).toLocaleString()}
          </p>
        </div>

        {/* Score + status */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <span className="text-xs text-slate-400 uppercase font-semibold block">Status</span>
            <span
              className={`mt-1 inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase ${
                review.status === 'COMPLETED'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : review.status === 'RUNNING'
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                  : review.status === 'FAILED'
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : 'bg-slate-700 text-slate-400'
              }`}
            >
              {review.status}
            </span>
          </div>
          <div className="text-center">
            <span className="text-xs text-slate-400 uppercase font-semibold block">Severity Score</span>
            <span className={`text-3xl font-black font-mono mt-1 block ${getSeverityScoreColor(review.severityScore)}`}>
              {review.severityScore !== undefined && review.severityScore !== null
                ? `${review.severityScore}/10`
                : '—'}
            </span>
          </div>
          <div className="text-center">
            <span className="text-xs text-slate-400 uppercase font-semibold block">Total Findings</span>
            <span className="text-3xl font-black font-mono text-white mt-1 block">{totalFindings}</span>
          </div>
        </div>
      </div>

      {/* Agent Summary Bar */}
      {review.agentSummary && Object.keys(review.agentSummary).length > 0 && (
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 px-5 py-4">
          <h3 className="text-xs text-slate-400 uppercase font-semibold mb-3">Findings by Agent</h3>
          <div className="flex flex-wrap gap-3">
            {CATEGORY_ORDER.map((cat) => {
              const count = review.agentSummary![cat] ?? 0;
              const meta = AGENT_META[cat];
              if (!meta) return null;
              return (
                <div key={cat} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${meta.bg}`}>
                  <span className="text-base">{meta.emoji}</span>
                  <div>
                    <div className={`text-xs font-bold ${meta.color}`}>{count}</div>
                    <div className="text-[10px] text-slate-400">{meta.label.split(' ')[0]}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Agent Status Stream */}
      <LiveAgentStatus reviewId={review.id} />

      {/* Findings by Category */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-white">Review Findings</h2>

        {Object.keys(findingsByCategory).length === 0 ? (
          <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-8 text-center">
            <div className="text-3xl mb-2">🔍</div>
            <p className="text-slate-400 text-sm">No agent findings logged yet. Check back after the review completes.</p>
          </div>
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const findings = findingsByCategory[cat];
            if (!findings || findings.length === 0) return null;
            const meta = AGENT_META[cat] || { emoji: '📋', label: cat, color: 'text-slate-300', bg: 'bg-slate-800 border-slate-700' };

            // Sort by severity
            const sevOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
            const sorted = [...findings].sort(
              (a, b) => (sevOrder[(a.severity || 'LOW').toUpperCase()] ?? 3) - (sevOrder[(b.severity || 'LOW').toUpperCase()] ?? 3)
            );

            return (
              <div key={cat} className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden">
                <div className={`px-5 py-3 border-b border-slate-800 flex items-center justify-between`}>
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">{meta.emoji}</span>
                    <h3 className={`font-semibold ${meta.color}`}>{meta.label}</h3>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${meta.bg} ${meta.color}`}>
                    {findings.length} issue{findings.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="divide-y divide-slate-800/60">
                  {sorted.map((f, idx) => {
                    const sevMeta = SEVERITY_META[(f.severity || 'LOW').toUpperCase()] || SEVERITY_META.LOW;
                    return (
                      <div key={idx} className="px-5 py-3.5 flex items-start gap-4 hover:bg-slate-800/30 transition-colors">
                        <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sevMeta.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center flex-wrap gap-2 mb-1">
                            <code className="text-xs text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded font-mono">
                              {f.file}{f.line > 0 ? `:${f.line}` : ''}
                            </code>
                            <span className={`text-[10px] font-bold uppercase ${sevMeta.text}`}>
                              {sevMeta.label}
                            </span>
                          </div>
                          <p className="text-sm text-slate-300 leading-relaxed">{f.issue}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
