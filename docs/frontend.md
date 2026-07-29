AutoReview — Frontend Plan
Landing Page, Dashboard & Live Websocket Status — Structure and Code

1. When to Build What
   The core product works without any frontend — GitHub webhook in, review comment out. The frontend is a wrapper for discovery, trust, and (optionally) a visual demonstration of the real-time architecture. Build it in this order:
   Phase What Why
   Phase 0 (Weeks 1-5) No frontend Core engine works entirely through GitHub — webhook in, comment out. Nothing to build on the frontend yet.
   Phase 1 (Week 6) Landing page only Needed so people can discover the product, understand it in 10 seconds, and click Install.
   Phase 2 (Week 8+) Dashboard + live status Build only once real users ask for history/settings, or when you want the websocket architecture to be visually demonstrable.
2. Frontend Tech Stack
   Layer Tool
   Framework Next.js (App Router)
   Styling Tailwind CSS
   Auth GitHub OAuth (NextAuth.js)
   Real-time Socket.io client
   Data fetching Simple REST calls to the Express backend (no need for GraphQL at this scale)
   Hosting Vercel (free tier is enough for MVP)
3. Part A — Landing Page (Week 6)
   Goal: a visitor understands what the product does and installs it within 10 seconds. Keep it to a single page — no routing complexity needed yet.
   Folder Structure
   autoreview-web/
   ├── app/
   │ ├── page.tsx # landing page (/)
   │ ├── layout.tsx # root layout, fonts, metadata
   │ └── globals.css
   ├── components/
   │ ├── Hero.tsx # headline + install CTA
   │ ├── DemoPreview.tsx # screenshot/GIF of a real review comment
   │ ├── HowItWorks.tsx # 3-step explainer
   │ └── Footer.tsx
   ├── public/
   │ └── demo.gif
   ├── tailwind.config.ts
   ├── package.json
   └── next.config.js
   Landing Page Code
   app/page.tsx
   import Hero from '@/components/Hero';
   import DemoPreview from '@/components/DemoPreview';
   import HowItWorks from '@/components/HowItWorks';
   import Footer from '@/components/Footer';

export default function LandingPage() {
return (
<main className="min-h-screen bg-white">
<Hero />
<DemoPreview />
<HowItWorks />
<Footer />
</main>
);
}
components/Hero.tsx
export default function Hero() {
const installUrl =
'https://github.com/apps/codezy-bot/installations/new';

return (
<section className="max-w-3xl mx-auto text-center py-24 px-4">
<h1 className="text-4xl font-bold mb-4">
AI code review that actually knows your repo
</h1>
<p className="text-lg text-gray-600 mb-8">
Multi-agent security &amp; style review, posted directly on
every pull request — in under a minute.
</p>
<a
        href={installUrl}
        className="inline-block bg-black text-white px-6 py-3 rounded-lg font-medium"
      >
Install on GitHub
</a>
</section>
);
}
Keep DemoPreview.tsx and HowItWorks.tsx as static content — a GIF/screenshot and a 3-step list. No backend calls needed on this page at all. 4. Part B — Dashboard (Week 8+, build only when needed)
This is what shows the live agent status and review history — the part that visually demonstrates your websocket + Redis pub/sub architecture. Build this once the core product is validated.
Folder Structure
autoreview-web/
├── app/
│ ├── dashboard/
│ │ ├── page.tsx # repo list + recent reviews
│ │ └── [prId]/
│ │ └── page.tsx # live status for one PR review
│ └── api/
│ └── auth/[...nextauth]/route.ts # GitHub OAuth
├── components/
│ ├── RepoList.tsx
│ ├── ReviewsTable.tsx
│ └── LiveAgentStatus.tsx # the websocket-driven component
├── lib/
│ ├── socket.ts # socket.io client singleton
│ └── api.ts # fetch helpers to the Express backend
└── ...
Live Agent Status — the Key Differentiator Component
lib/socket.ts
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

// Singleton so we don't open a new connection on every re-render.
export function getSocket(): Socket {
if (!socket) {
socket = io(process.env.NEXT_PUBLIC_API_URL!, {
transports: ['websocket'],
});
}
return socket;
}
components/LiveAgentStatus.tsx
'use client';

import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/socket';

type AgentEvent = {
agent: 'style' | 'security';
status: 'queued' | 'running' | 'done';
};

export default function LiveAgentStatus({ reviewId }: { reviewId: string }) {
const [events, setEvents] = useState<AgentEvent[]>([]);

useEffect(() => {
const socket = getSocket();
// Backend rooms events by reviewId so each dashboard tab only
// gets updates for the PR it's looking at.
socket.emit('subscribe', { reviewId });

    const handler = (event: AgentEvent) => {
      setEvents((prev) => [...prev, event]);
    };
    socket.on(`agent-status:${reviewId}`, handler);

    return () => {
      socket.off(`agent-status:${reviewId}`, handler);
    };

}, [reviewId]);

return (
<div className="space-y-2">
{events.map((e, i) => (
<div key={i} className="flex items-center gap-2 text-sm">
<span className="font-medium capitalize">{e.agent} agent</span>
<span className="text-gray-500">{e.status}</span>
</div>
))}
</div>
);
}
This maps directly to the socket.emit('agent-status', {...}) calls your BullMQ worker already makes on the backend — the dashboard is just subscribing to the same events, scoped by reviewId.
Repo List + Reviews Table (server-rendered, simple REST)
app/dashboard/page.tsx
import RepoList from '@/components/RepoList';
import ReviewsTable from '@/components/ReviewsTable';

async function getReviews() {
const res = await fetch(`${process.env.API_URL}/api/reviews`, {
cache: 'no-store',
});
return res.json();
}

export default async function DashboardPage() {
const reviews = await getReviews();

return (
<div className="max-w-5xl mx-auto py-10 px-4">
<h1 className="text-2xl font-semibold mb-6">Dashboard</h1>
<RepoList />
<ReviewsTable reviews={reviews} />
</div>
);
}
RepoList and ReviewsTable are plain presentational components — they just map over data and render a table/list. No special logic worth detailing until real data shapes are settled. 5. Backend Change Needed to Support This
The Express backend needs two small additions once you get here — both are natural extensions of what already exists from Weeks 1–5:
• Attach Socket.io to the existing Express server, and emit agent-status events from the BullMQ worker at each stage (queued → running → done) — the worker already has these transition points from Week 4/5.
• Add two simple REST endpoints: GET /api/reviews (list recent reviews) and GET /api/reviews/:id (single review detail) — reading from the pr_reviews and agent_runs tables already planned in the Week 1–5 schema. 6. Priority Reminder
• Do not start the dashboard before the core engine (Weeks 1–5) is fully working end-to-end.
• Ship the landing page alone first and get real installs — it tells you whether the dashboard is even worth building yet.
• When you do build the dashboard, the Live Agent Status component is the one worth polishing — it's the part that visually proves the multi-agent, queue-based architecture to anyone looking at your portfolio.
