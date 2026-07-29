'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/socket';

interface AgentEvent {
  agent: string;
  status: 'queued' | 'running' | 'done' | 'completed' | 'failed';
  message?: string;
  findingsCount?: number;
  severityScore?: number;
  timestamp?: string;
}

// Agent display metadata
const AGENT_META: Record<string, { emoji: string; label: string; color: string }> = {
  supervisor:  { emoji: '🧠', label: 'Supervisor',    color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  git_hygiene: { emoji: '🔑', label: 'Git Hygiene',   color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  security:    { emoji: '🔒', label: 'Security',      color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  logic:       { emoji: '🧩', label: 'Logic',         color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
  performance: { emoji: '⚡', label: 'Performance',   color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  testing:     { emoji: '🧪', label: 'Testing',       color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20' },
  style:       { emoji: '🎨', label: 'Style',         color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
  judge:       { emoji: '⚖️',  label: 'Judge',        color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
};

const STATUS_DOT: Record<string, string> = {
  running:   'bg-amber-400 animate-pulse',
  done:      'bg-emerald-400',
  completed: 'bg-emerald-400',
  failed:    'bg-red-400',
  queued:    'bg-slate-500',
};

export default function LiveAgentStatus({ reviewId }: { reviewId: string }) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    function onConnect() {
      setConnected(true);
      socket.emit('subscribe', { reviewId });
    }

    function onDisconnect() {
      setConnected(false);
    }

    if (socket.connected) {
      onConnect();
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const eventHandler = (event: AgentEvent) => {
      setEvents((prev) => [...prev, { ...event, timestamp: new Date().toLocaleTimeString() }]);
    };

    socket.on(`agent-status:${reviewId}`, eventHandler);

    return () => {
      socket.emit('unsubscribe', { reviewId });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(`agent-status:${reviewId}`, eventHandler);
    };
  }, [reviewId]);

  return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center space-x-2.5">
          <div className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
          <h3 className="text-sm font-semibold text-white">Live Agent Execution Stream</h3>
        </div>
        <span className="text-xs text-slate-400 font-mono">
          {connected ? '● WebSocket Connected' : '○ Connecting...'}
        </span>
      </div>

      {/* Events feed */}
      <div className="p-4">
        {events.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-3xl mb-2 opacity-50">📡</div>
            <p className="text-sm text-slate-400 italic">Waiting for agent events...</p>
            <p className="text-xs text-slate-500 mt-1">Events will appear here as agents run</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
            {events.map((e, idx) => {
              const meta = AGENT_META[e.agent?.toLowerCase()] || {
                emoji: '🤖',
                label: e.agent,
                color: 'text-slate-300 bg-slate-800/50 border-slate-700',
              };
              const dotColor = STATUS_DOT[e.status] || 'bg-slate-500';

              return (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 font-mono text-xs"
                >
                  {/* Agent badge */}
                  <span className={`shrink-0 px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${meta.color}`}>
                    {meta.emoji} {meta.label}
                  </span>

                  {/* Status dot + message */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                    <span className="text-slate-200 truncate">
                      {e.message || `Status: ${e.status}`}
                      {e.findingsCount !== undefined && (
                        <span className="ml-1.5 text-slate-400">({e.findingsCount} findings)</span>
                      )}
                      {e.severityScore !== undefined && (
                        <span className="ml-1.5 font-bold text-amber-400">Score: {e.severityScore}/10</span>
                      )}
                    </span>
                  </div>

                  {/* Timestamp */}
                  <span className="text-slate-600 text-[10px] whitespace-nowrap shrink-0">{e.timestamp}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
