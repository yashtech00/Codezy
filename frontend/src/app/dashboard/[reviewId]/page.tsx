import LiveAgentStatus from '@/components/LiveAgentStatus';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface AgentRun {
  id: string;
  agentType: string;
  status: string;
  findingsJson?: any;
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
  createdAt: string;
  agentRuns: AgentRun[];
}

async function getReview(reviewId: string): Promise<Review | null> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    const res = await fetch(`${apiUrl}/api/reviews/${reviewId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.review || null;
  } catch (error) {
    console.error('Failed to fetch review detail:', error);
    return null;
  }
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
          &larr; Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-xs text-indigo-400 hover:underline">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-3xl font-extrabold text-white mt-2">
            Review for {review.repoFullName} <span className="text-indigo-400">#{review.prNumber}</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-1">Commit SHA: {review.headSha}</p>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-right">
            <span className="text-xs text-slate-400 block uppercase font-semibold">Severity Score</span>
            <span className="text-2xl font-bold text-white font-mono">
              {review.severityScore !== undefined && review.severityScore !== null
                ? `${review.severityScore}/10`
                : 'Pending'}
            </span>
          </div>
        </div>
      </div>

      {/* Live Agent Status Component */}
      <LiveAgentStatus reviewId={review.id} />

      {/* Agent Run Findings Breakdown */}
      <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-6">
        <h3 className="text-lg font-semibold text-white">Agent Run Breakdown &amp; Findings</h3>

        {review.agentRuns && review.agentRuns.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-6">
            {review.agentRuns.map((ar) => (
              <div key={ar.id} className="p-5 rounded-lg bg-slate-950/80 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-indigo-500/10 text-indigo-400 uppercase">
                    {ar.agentType} Agent
                  </span>
                  <span className="text-xs font-mono text-emerald-400">{ar.status}</span>
                </div>

                <div className="text-xs text-slate-300 font-mono space-y-2">
                  {ar.findingsJson && Array.isArray(ar.findingsJson) && ar.findingsJson.length > 0 ? (
                    ar.findingsJson.map((f: any, idx: number) => (
                      <div key={idx} className="p-2.5 rounded bg-slate-900 border border-slate-800 space-y-1">
                        <div className="text-indigo-300 font-bold">
                          {f.file}:{f.line} [{f.severity}]
                        </div>
                        <div className="text-slate-400">{f.issue}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-500 italic">No issues detected by this agent.</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-400 italic">No agent runs logged yet for this review.</div>
        )}
      </div>
    </div>
  );
}
