AutoReview
Multi-Agent GitHub PR Reviewer — MVP Build Plan
1. Scope — MVP Boundaries
Keep the MVP tight. Full production scope will slow down shipping. Boundaries for v1:
•     Support public GitHub repos only initially — private repos become the paid tier later.
•     Start with 2 agents instead of 4: Style/Quality Agent and Security Agent. Test-coverage and performance agents come after MVP validates the core loop.
•     Review only at diff level — never re-analyze the whole repo on every PR, only changed files.
2. High-Level Architecture
GitHub PR Event -> Webhook Receiver (Express)
        |
   Redis Queue (BullMQ) -> Job created
        |
   Worker picks job -> LangGraph Supervisor Agent
        |
   Supervisor decides: PR size/type -> route to Style Agent / Security Agent (parallel)
        |
   Each agent: fetch diff + relevant RAG context -> analyze -> return findings
        |
   Merge results -> format as markdown ->
        |
   Post comment via GitHub API + emit websocket event (live dashboard)
3. Component-by-Component Breakdown
A. GitHub App Setup (Day 1–2)
•     Create a GitHub App (not an OAuth App) — App gives fine-grained permissions and webhook events.
•     pull_requests: read/write, contents: read, checks: writePermissions needed: 
•     Subscribe to webhook events: pull_request.opened and pull_request.synchronize (fires on new commits pushed).
•     Generate a private key — used to build a JWT to authenticate GitHub API calls as the app.
B. Webhook Receiver (Express) — Day 3–4
POST /webhook/github
•     Verify the incoming GitHub payload using the X-Hub-Signature-256 header (HMAC verification) — essential, otherwise anyone can send a fake webhook.
•     Extract repo, pr_number, installation_id, diff_url from the payload.
•     Push a job object onto the Redis queue and return 200 OK immediately — GitHub expects a fast response or it retries.
C. Queue System (BullMQ + Redis) — Day 4–5
•     This is where the pub/sub + worker pattern comes in. Queue name: pr-review-queue.
•     Job payload: { repoFullName, prNumber, installationId, headSha }
•     Set concurrency control — a worker pool processing 5–10 jobs in parallel (BullMQ's concurrency option makes this simple).
•     Handle GitHub's API rate limits here too — add per-installation throttling.
D. Diff Fetching + Preprocessing — Day 6–7
•     Worker picks up the job and fetches the PR diff via GitHub API: GET /repos/{owner}/{repo}/pulls/{pr}/files
•     Extract the patch (diff hunks) for each changed file.
•     Truncate/chunk large files (>500 lines changed) — keep the LLM context window in mind.
•     Skip binary files, lock files (package-lock.json), and generated files via a filter list.
E. RAG Layer — Repo Context — Day 8–10
This is the most important differentiator of the whole product. Keep it simple for MVP:
•     When a repo is first connected, run a background job that reads README, CONTRIBUTING.md, and lint/style config files (e.g. .eslintrc).
•     Index the titles and review comments (where available) of the last 20–30 merged PRs.
•     Chunk all of this, generate embeddings (OpenAI embeddings or an open-source model such as bge-small), and store them in a vector store — pgvector or Qdrant both work as free/self-hosted options for MVP, no extra infra cost.
•     When an agent runs, retrieve the top-k relevant chunks (e.g. “similar past style violations” or “project convention docs”) and inject them into the prompt.
F. LangGraph — Supervisor + Agents — Day 11–14
This is the core intelligence layer.
Supervisor node logic:
Input: diff stats (files changed, lines added/removed, file types)
Decision:
  - if only .md/.json/config files changed -> skip AI review, comment "no code changes"
  - if diff < 50 lines -> run Style Agent only
  - if diff >= 50 lines -> run Style Agent + Security Agent in parallel
Style Agent:
•     Input: diff + RAG context (project conventions).
•     Prompt intent: find naming, formatting, code-smell, and best-practice violations, judged against the repo's own conventions.
•     Output: structured JSON — { file, line, issue, severity }
Security Agent:
•     Input: diff only — RAG context matters less here.
•     Prompt intent: check for common vulnerabilities — hardcoded secrets, SQL injection risk, unsafe eval, missing input validation.
•     Output: same structured format as the Style Agent.
Both agents run as parallel branches in LangGraph; the supervisor merges their output.
Tip: give the model a strict JSON schema via function calling / tool use for structured output — otherwise parsing gets unreliable.
G. Result Merging + Posting — Day 15–16
•     Combine both agents' output and calculate a severity score (weighted — security issues should outweigh style issues).
•     Format the results as a markdown comment, for example:
## AutoReview Summary
Severity Score: 7/10
 
### Security (2 issues)
- auth.js:45 - Hardcoded API key detected
 
### Style (3 issues)
- utils.js:12 - Inconsistent naming convention
•     Post the comment to the PR via GitHub API: POST /repos/{owner}/{repo}/issues/{pr}/comments
•     Optional: also use the GitHub Checks API to show a pass/fail check on the PR.
H. Websocket Dashboard — Day 17–19
•     As the worker processes each stage, emit a websocket event (e.g. socket.emit('agent-status', {...})).
•     Build a simple Next.js dashboard where a user connects their repo and watches live: “PR #42 — Security Agent running... Style Agent done.”
•     This live-status view is a key differentiator — most tools only show the final comment, this shows the process transparently.
I. Auth + Multi-tenancy — Day 20–21
•     GitHub OAuth login — users connect their GitHub account.
Database schema (Postgres):
•     installations — installation_id, repo_list, plan_type
•     pr_reviews — pr_number, repo, status, severity_score, created_at
•     agent_runs — review_id, agent_type, status, findings_json
4. Tech Stack Summary for MVP
Layer	Tool
Backend	Node.js + Express
Queue	Redis + BullMQ
AI Orchestration	LangGraph
Vector DB	pgvector (Postgres extension)
Real-time	Socket.io
Frontend Dashboard	Next.js
Database	PostgreSQL
Deployment	Docker Compose → Railway/Render (MVP hosting)
5. Week-by-Week Plan (≈ 5–6 weeks at 15+ hrs/week)
Week	Focus
Week 1	GitHub App setup, webhook receiver, signature verification, basic queue push
Week 2	BullMQ worker setup, diff fetching, preprocessing/filtering logic
Week 3	RAG pipeline — repo indexing, embeddings, vector store setup
Week 4	LangGraph supervisor + Style Agent + Security Agent, structured output
Week 5	Result merging, GitHub comment posting, websocket events, basic dashboard
Week 6	Auth, multi-tenancy DB, polish, deploy, README, demo video, launch prep
6. Launch Checklist
•     Record a 30–60 second demo video showing how a review appears on a PR.
•     Write a clear architecture diagram in the README — this instantly signals engineering depth to recruiters and developers.
•     Draft a GitHub Marketplace listing.
•     Post a genuine “I built this” story on Reddit (r/programming, r/webdev) and a screenshot thread on Twitter/X.
7. Why This Is Unique
Most PR-review tools run a single agent over the whole diff. AutoReview combines three things that individually are common but together are rare: a multi-agent system with a supervisor that routes work based on PR size, a queue-based worker architecture that demonstrates horizontal scaling, and a live status dashboard that makes the review process transparent instead of a black box. That combination is genuinely interview-worthy engineering, not just an LLM wrapper.
