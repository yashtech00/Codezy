# AutoReview — End-to-End Implementation Plan (Backend + Prisma DB + LangGraph + Next.js Dashboard)

Building **AutoReview**, a multi-agent GitHub PR reviewer system with real-time WebSocket dashboard support, Prisma + PostgreSQL persistence, and LangGraph orchestration.

## User Review Required

> [!IMPORTANT]
> - **Database**: PostgreSQL with Prisma ORM will store `Installation`, `PrReview`, and `AgentRun` records.
> - **Real-time Pipeline**: Express + Socket.io server broadcasting progress updates from BullMQ worker jobs directly to the Next.js live dashboard.
> - **AI Pipeline**: LangGraph supervisor routing diffs to Style and Security agents operating in parallel with structured JSON outputs.

## Proposed System Architecture

```
GitHub Webhook ---> Express Server (HMAC Signature Check)
                        |
                        +---> Prisma DB (Create PrReview & AgentRun records: QUEUED)
                        |
                        +---> BullMQ (Redis Queue)
                                 |
                        Worker Processing (Socket.io Emits Live Status)
                                 |
                        +---> Fetch Diff & Filter (Octokit)
                        +---> LangGraph Supervisor Routing
                        |       |---> Style Agent (RAG Context + Diff)
                        |       +---> Security Agent (Security Scan)
                        +---> Merge Results & Compute Severity Score
                        |
                        +---> Post Markdown Comment to GitHub PR
                        +---> Update Prisma DB (COMPLETED) & Emit Socket.io 'agent-status:done'
```

---

## Proposed Changes

### Component 1: Database & Prisma Setup (`backend/prisma`)

#### [NEW] [schema.prisma](file:///Users/yashgupta/Desktop/me/codezy/backend/prisma/schema.prisma)
Define PostgreSQL schema for multi-tenancy and review history:
- `Installation`: `id`, `githubInstallationId` (unique), `repoList` (Json/String), `planType` (default: "FREE"), `createdAt`, `updatedAt`
- `PrReview`: `id` (cuid), `prNumber` (Int), `repoFullName` (String), `headSha` (String), `status` (Enum: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`), `severityScore` (Int?), `summary` (String?), `installationId` (String?), `createdAt`, `updatedAt`
- `AgentRun`: `id` (cuid), `reviewId` (FK to `PrReview`), `agentType` (Enum: `STYLE`, `SECURITY`), `status` (Enum: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`), `findingsJson` (Json?), `startedAt`, `completedAt`

#### [NEW] [db.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/config/db.js)
Prisma client singleton export to reuse database connections across the Express API and BullMQ worker.

---

### Component 2: Infrastructure & Environment Setup

#### [MODIFY] [package.json](file:///Users/yashgupta/Desktop/me/codezy/backend/package.json)
Add dependencies: `@prisma/client`, `prisma`, `express`, `dotenv`, `bullmq`, `ioredis`, `socket.io`, `@octokit/rest`, `@octokit/auth-app`, `@langchain/core`, `@langchain/langgraph`, `@langchain/openai`.

#### [NEW] [docker-compose.yml](file:///Users/yashgupta/Desktop/me/codezy/backend/docker-compose.yml)
Services for local development:
- `postgres` (PostgreSQL 16)
- `redis` (Redis 7)

#### [NEW] [.env.example](file:///Users/yashgupta/Desktop/me/codezy/backend/.env.example)
Define environment config: `PORT`, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_PRIVATE_KEY_PATH`, `OPENAI_API_KEY`.

---

### Component 3: Backend Ingestion, Worker & WebSocket Engine (`backend/src`)

#### [NEW] [env.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/config/env.js)
Environment validation and export module (fails fast if keys are missing).

#### [NEW] [verifySignature.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/middleware/verifySignature.js)
HMAC `crypto.timingSafeEqual` signature verification on raw request body.

#### [NEW] [webhook.route.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/routes/webhook.route.js)
Receives `POST /webhook/github`, validates signature, creates `PrReview` and `AgentRun` records in Prisma with status `QUEUED`, enqueues BullMQ job, and returns HTTP 200.

#### [NEW] [api.route.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/routes/api.route.js)
Dashboard REST API endpoints:
- `GET /api/reviews`: List recent PR reviews with status and severity scores.
- `GET /api/reviews/:id`: Detailed view of a single PR review and its agent runs/findings.

#### [NEW] [socket.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/config/socket.js)
Socket.io initialization helper for real-time room-based streaming (`subscribe` to `reviewId`).

#### [NEW] [github.service.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/services/github.service.js)
Octokit instance factory authenticated via GitHub App installation JWT. Methods: `fetchPrDiff`, `postPrComment`.

#### [NEW] [diffPreprocessor.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/services/diffPreprocessor.js)
Extracts diff hunks, filters lockfiles (`package-lock.json`), binaries, and generated files, and truncates large diffs (>500 lines).

#### [NEW] [agents.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/agents/reviewAgents.js)
LangGraph supervisor + Style Agent + Security Agent setup with structured JSON function calling output schema `{ file, line, issue, severity }`.

#### [NEW] [reviewWorker.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/queue/reviewWorker.js)
BullMQ worker:
1. Emits `agent-status` via Socket.io.
2. Updates Prisma `PrReview` & `AgentRun` status to `RUNNING`.
3. Fetches diff and runs LangGraph agents.
4. Aggregates findings, computes overall severity score, and posts GitHub comment.
5. Updates Prisma status to `COMPLETED` and emits completion WebSocket event.

#### [NEW] [app.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/app.js) & [server.js](file:///Users/yashgupta/Desktop/me/codezy/backend/src/server.js)
Express app configuration with `express.raw()` on `/webhook/github`, HTTP server creation with attached Socket.io server and BullMQ worker initialization.

---

### Component 4: Next.js Live Dashboard (`frontend`)

#### [NEW] [frontend/package.json](file:///Users/yashgupta/Desktop/me/codezy/frontend/package.json)
Next.js (App Router), Tailwind CSS, `socket.io-client`, `lucide-react`.

#### [NEW] [frontend/src/app/page.tsx](file:///Users/yashgupta/Desktop/me/codezy/frontend/src/app/page.tsx)
Landing Page & GitHub App Installation Hero.

#### [NEW] [frontend/src/app/dashboard/page.tsx](file:///Users/yashgupta/Desktop/me/codezy/frontend/src/app/dashboard/page.tsx)
Dashboard showing repository list and recent PR review history table fetched from backend `/api/reviews`.

#### [NEW] [frontend/src/app/dashboard/[reviewId]/page.tsx](file:///Users/yashgupta/Desktop/me/codezy/frontend/src/app/dashboard/[reviewId]/page.tsx)
Live PR Review detail page featuring `LiveAgentStatus` WebSocket listener showing real-time agent execution progression and findings breakdown.

#### [NEW] [frontend/src/components/LiveAgentStatus.tsx](file:///Users/yashgupta/Desktop/me/codezy/frontend/src/components/LiveAgentStatus.tsx)
Real-time status component listening to `agent-status:${reviewId}` Socket.io events.

---

## Verification Plan

### Automated / Command Verification
1. **Database Migration**: Run `npx prisma db push` or `npx prisma migrate dev` to generate Prisma Client and verify schema creation.
2. **Backend Server Boot**: Start Redis & Postgres via Docker, then run `npm run dev` in `backend/` to ensure Express, BullMQ, Prisma, and Socket.io initialize without errors.
3. **Frontend Dashboard Build**: Run `npm run build` in `frontend/` to verify Next.js TypeScript and Tailwind CSS compilation.

### Manual End-to-End Verification
1. **Mock Webhook Payload Test**: Send a signed `pull_request.opened` mock webhook payload to `http://localhost:3000/webhook/github`.
2. **Database Verification**: Check PostgreSQL tables to confirm `PrReview` and `AgentRun` rows were created.
3. **Real-time UI Test**: Open the Next.js dashboard at `http://localhost:3001/dashboard/[reviewId]` and observe real-time Socket.io status updates as the worker runs.
