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
    <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
          <h3 className="text-base font-semibold text-white">Live Execution Stream</h3>
        </div>
        <span className="text-xs text-slate-400 font-mono">
          {connected ? 'WebSocket Connected' : 'Connecting...'}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="text-sm text-slate-400 italic py-4 text-center">
          Waiting for live agent status events...
        </div>
      ) : (
        <div className="space-y-3 font-mono text-xs max-h-64 overflow-y-auto pr-2">
          {events.map((e, idx) => (
            <div
              key={idx}
              className="flex items-start justify-between p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80"
            >
              <div className="flex items-center space-x-3">
                <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-bold uppercase text-[10px]">
                  {e.agent}
                </span>
                <span className="text-slate-200">
                  {e.message || `Status: ${e.status}`}
                  {e.findingsCount !== undefined && ` (${e.findingsCount} findings)`}
                  {e.severityScore !== undefined && ` [Severity Score: ${e.severityScore}/10]`}
                </span>
              </div>
              <span className="text-slate-500 text-[10px] whitespace-nowrap ml-2">{e.timestamp}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
