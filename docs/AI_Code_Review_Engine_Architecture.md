# Production-Grade AI Code Review Engine
## Consolidated Architecture, Review Pillars, Cost Optimization, and Implementation Blueprint

> This document consolidates the complete discussion on building a strong push-based AI code review web application, including review pillars, CodeRabbit-inspired review logic, PR-Agent-inspired cost optimization, context management, verification, severity/confidence scoring, and a practical production architecture.

---

# 1. Product Goal

The product is a **continuous AI code review system** that runs on every Git push or pull request update.

The goal should **not** be:

> Send the Git diff to an LLM and ask, “Review this code.”

The goal should be:

> Build a risk-detection engine that understands what changed, determines what types of risks are relevant, gathers only the required repository context, runs deterministic tools first, uses AI where reasoning is required, verifies suspicious findings, and reports only high-value issues introduced by the current change.

A production-grade review flow should therefore follow:

```text
Detect
  ↓
Understand
  ↓
Route
  ↓
Analyze
  ↓
Investigate
  ↓
Verify
  ↓
Rank
  ↓
Deduplicate
  ↓
Report
```

The differentiator is not how many issues the AI finds.

The differentiator is:

> **How many findings developers trust.**

---

# 2. Core Design Principles

The system should follow these principles:

1. **Review changed behavior, not just changed lines.**
2. **Use deterministic tooling before spending LLM tokens.**
3. **Do not run every review pillar on every push.**
4. **Retrieve only relevant repository context.**
5. **Separate pillar, severity, confidence, detector, and policy.**
6. **Verify high-impact or uncertain findings before publishing them.**
7. **Prefer a few important findings over dozens of low-value comments.**
8. **Review only issues introduced or materially changed by the current push.**
9. **Use repository-specific rules instead of generic best practices everywhere.**
10. **Treat cost and token usage as first-class system constraints.**

---

# 3. What CodeRabbit Publicly Appears to Do

CodeRabbit does not publicly expose its exact prompts or proprietary scoring logic, but its public documentation describes a multi-layer architecture.

Conceptually:

```text
Repository
   ↓
Static / SAST Analysis
   ↓
Repository & Dependency Context
   ↓
Agentic Investigation
   ↓
Finding Verification
   ↓
Severity / Review Output
```

Important public ideas include:

- repository cloning into an isolated review environment,
- linters and static analysis tools,
- codebase exploration,
- review agents,
- verification agents,
- prior PR/issues/review guidance,
- path-specific review instructions,
- learnings from developer feedback,
- incremental review for subsequent commits,
- cross-file and cross-repository context,
- pre-merge checks separate from normal review comments.

Useful reference documentation:

- https://docs.coderabbit.ai/overview/architecture
- https://docs.coderabbit.ai/guides/code-review-overview
- https://docs.coderabbit.ai/security-agent
- https://docs.coderabbit.ai/tools
- https://docs.coderabbit.ai/configuration/path-instructions
- https://docs.coderabbit.ai/configuration/ast-grep-instructions
- https://docs.coderabbit.ai/knowledge-base
- https://docs.coderabbit.ai/knowledge-base/learnings
- https://docs.coderabbit.ai/pr-reviews/pre-merge-checks

---

# 4. Review Pillars

A strong system should use clearly separated review pillars.

Recommended structure:

| # | Pillar | Suggested Weight | Purpose |
|---|---|---:|---|
| 1 | Functional Correctness | 25% | Detect incorrect behavior and business-logic defects |
| 2 | Security & Privacy | 20% | Detect vulnerabilities, access-control flaws, secrets, and unsafe input handling |
| 3 | Reliability & Error Handling | 12% | Detect failure-mode, concurrency, retry, and resilience issues |
| 4 | Data Integrity & Contracts | 12% | Detect DB, schema, API, event, and integration consistency problems |
| 5 | Performance & Scalability | 10% | Detect meaningful runtime, database, memory, and scaling problems |
| 6 | Architecture & Maintainability | 8% | Detect architectural violations, duplication, coupling, and maintainability risks |
| 7 | Testing & Regression Risk | 8% | Detect behavior changes without sufficient test protection |
| 8 | Observability & Production Readiness | 5% | Detect logging, configuration, diagnostics, and production-readiness issues |

These weights should primarily help dashboards and prioritization.

They should **not** replace severity.

A single critical authorization vulnerability must outweigh many clean-code successes.

---

# 5. Pillar 1 — Functional Correctness

## Objective

Determine whether the code behaves correctly according to its apparent intent and existing system contracts.

## Checks

- incorrect conditions,
- off-by-one errors,
- null or undefined handling,
- invalid assumptions,
- missing edge cases,
- incorrect return values,
- broken state transitions,
- wrong branching,
- unreachable code,
- async ordering issues,
- incorrect fallback behavior,
- business-rule violations,
- caller/callee mismatch,
- unexpected behavioral regression.

## Example

```ts
if (user.role === "ADMIN" || "SUPER_ADMIN") {
    allow();
}
```

This condition is always truthy because `"SUPER_ADMIN"` is truthy.

A good reviewer should say what breaks:

> Any user may pass this condition, which can bypass the intended role restriction.

Do not reduce this to a style comment.

---

# 6. Pillar 2 — Security & Privacy

Security should be a hard review area for high-risk files.

## Authentication

Check:

- missing authentication,
- token validation,
- expired session handling,
- unsafe session lifecycle,
- insecure cookie settings,
- JWT validation mistakes.

## Authorization

Check:

- missing role checks,
- resource ownership,
- IDOR,
- horizontal privilege escalation,
- vertical privilege escalation,
- authorization applied at the wrong layer.

## Injection

Check:

- SQL injection,
- NoSQL injection,
- command injection,
- template injection,
- XSS,
- unsafe shell execution.

## Sensitive Information

Check:

- API keys,
- credentials,
- hard-coded passwords,
- access tokens,
- PII leakage,
- sensitive logs.

## Input Boundaries

Check:

- missing validation,
- unsafe file upload,
- SSRF,
- path traversal,
- unsafe redirects,
- unsafe external URLs.

## Cryptography

Check:

- weak hashes,
- insecure randomness,
- unsafe encryption patterns,
- homemade cryptography.

## Recommended Security Analysis Pattern

```text
MAP
 ↓
INVESTIGATE
 ↓
VERIFY
```

### Map

Understand:

- entry point,
- authentication,
- authorization,
- data flow,
- external calls,
- sensitive operations.

### Investigate

Trace potentially vulnerable execution paths.

### Verify

Before reporting:

- Is this path reachable?
- Is protection enforced elsewhere?
- Is the code test-only?
- Is the vulnerability introduced by this push?
- Is the assumption actually possible?

---

# 7. Pillar 3 — Reliability & Error Handling

Correctness asks:

> Does it produce the right answer?

Reliability asks:

> Does the system remain safe when something goes wrong?

## Checks

- missing error handling,
- swallowed exceptions,
- failed Promise handling,
- retry storms,
- timeout handling,
- partial writes,
- race conditions,
- resource leaks,
- connection cleanup,
- deadlocks,
- non-idempotent retries,
- external-service failures,
- transaction boundaries,
- infinite loops,
- uncontrolled concurrency,
- unsafe fallback behavior.

## Example

```ts
await prisma.user.create(data);
await externalBilling.createCustomer(data);
```

If the second call fails, the system may leave partially created state.

The reviewer should analyze whether:

- compensation exists,
- retry is safe,
- a transaction or saga is required,
- the partial state is acceptable.

---

# 8. Pillar 4 — Data Integrity & Contracts

This deserves its own pillar because many serious issues happen at system boundaries.

## Database

Check:

- schema/application mismatch,
- nullable assumptions,
- unique constraints,
- unsafe migrations,
- incorrect relations,
- missing transaction boundaries,
- duplicate record creation,
- cascade consequences,
- lost updates,
- stale-write race conditions.

## API Contracts

Check:

- request DTO changes,
- response DTO changes,
- frontend/backend mismatch,
- GraphQL schema drift,
- OpenAPI drift,
- event payload drift,
- queue payload drift,
- Redis message changes,
- environment-variable assumptions.

## Example

Frontend expects:

```text
user.fullName
```

Backend changes output to:

```text
user.name
```

Both files may compile independently, while the application still breaks.

This requires repository-level context.

---

# 9. Pillar 5 — Performance & Scalability

The reviewer should detect meaningful performance risks, not random micro-optimizations.

## Checks

- N+1 DB queries,
- unnecessary sequential awaits,
- O(n²) / O(n³) loops,
- blocking I/O,
- repeated parsing,
- large allocations,
- excessive payloads,
- missing pagination,
- over-fetching database fields,
- unbounded concurrency,
- inefficient queries,
- repeated external API calls,
- expensive synchronous work in request handlers,
- cache misuse,
- index-sensitive query changes.

## Example

```ts
for (const learner of learners) {
    await prisma.progress.findMany({
        where: { learnerId: learner.id }
    });
}
```

Weak review:

> Avoid await inside loops.

Strong review:

> This performs one query per learner. For 1,000 learners the endpoint may execute roughly 1,001 database calls. Fetch all progress rows in a single query and group them by learner ID.

---

# 10. Pillar 6 — Architecture & Maintainability

The system should understand the repository's actual architecture.

Do not blindly enforce arbitrary patterns.

## Checks

- layer violations,
- direct DB access from controllers when forbidden,
- duplicated domain logic,
- incorrect dependency direction,
- tight coupling,
- circular dependencies,
- oversized responsibilities,
- dead code,
- inconsistent abstractions,
- confusing naming when it affects maintenance,
- repeated implementations,
- violations of repository-specific conventions.

A comment such as:

> “This function could be smaller”

should generally be suppressed unless there is a real consequence.

---

# 11. Pillar 7 — Testing & Regression Risk

Do not evaluate testing only by line coverage.

The key question is:

> What behavior changed, and is that behavior protected?

## Checks

- business logic changed without tests,
- missing authorization test,
- happy path only,
- missing failure-path tests,
- missing boundary tests,
- weak assertions,
- tests that mock away the important logic,
- changed API contract without tests,
- changed validation rules without tests,
- flaky time-dependent behavior,
- tests that always pass,
- changed edge-case handling without test coverage.

## Suggested Flow

```text
Production behavior changed
        ↓
Find related tests
        ↓
Determine affected behavior
        ↓
Check whether test cases prove it
```

---

# 12. Pillar 8 — Observability & Production Readiness

Useful especially for backend, distributed, and cloud systems.

## Checks

- errors logged without useful context,
- sensitive values logged,
- console statements left in production paths,
- swallowed errors,
- missing correlation identifiers,
- weak operational diagnostics,
- unsafe configuration defaults,
- environment assumptions,
- important failure paths with no logs/metrics,
- inconsistent retry/timeout configuration.

---

# 13. Keep Review Dimensions Separate

Do not mix everything into one field called `type`.

A finding should separate:

```text
PILLAR
What class of risk is this?

CHECK
What exact rule or behavior is being evaluated?

DETECTOR
How was it discovered?

SEVERITY
How dangerous is it?

CONFIDENCE
How certain are we?

POLICY
Does it block or only warn?
```

Example:

```json
{
  "pillar": "SECURITY_PRIVACY",
  "check": "BROKEN_OBJECT_AUTHORIZATION",
  "detector": "AI_DATA_FLOW_ANALYZER",
  "severity": "CRITICAL",
  "confidence": 0.94
}
```

---

# 14. Severity Model

Recommended levels:

```text
CRITICAL
MAJOR
MINOR
TRIVIAL
INFO
```

## Critical

Examples:

- authentication bypass,
- remote exploit,
- privilege escalation,
- credential exposure,
- permanent data loss,
- payment compromise,
- major production outage.

## Major

Examples:

- important user-facing logic break,
- material data corruption,
- major reliability failure,
- significant performance regression.

## Minor

Examples:

- limited edge-case defect,
- smaller reliability issue,
- maintainability problem with concrete impact.

## Trivial

Examples:

- naming,
- readability,
- small refactor suggestion.

## Info

Examples:

- optional architectural observation,
- education,
- non-blocking recommendation.

---

# 15. Severity Should Be Computed, Not Arbitrarily Guessed

A conceptual risk formula:

```text
Risk =
Impact
× Reachability
× Probability
× Scope
× Exploitability
```

The exact scoring can be tuned later from real review data.

For security findings, factors may include:

- attack surface,
- authentication state,
- user control,
- remote/local access,
- sensitive-data impact,
- privilege impact,
- persistence,
- exploit complexity.

---

# 16. Confidence Model

Severity and confidence are different.

A finding can be:

```text
Critical severity
but
55% confidence
```

That should probably trigger verification instead of immediate publication.

A possible confidence model:

```text
confidence =
0.30 × codeEvidence
+ 0.20 × reachabilityEvidence
+ 0.20 × deterministicSupport
+ 0.15 × repositoryContext
+ 0.15 × verifierAgreement
```

Example publishing policy:

```text
>= 0.90
→ publish normally

0.75–0.90
→ publish when severity is important

0.60–0.75
→ verifier or summary-only

< 0.60
→ suppress
```

These numbers are starting points, not permanent constants.

---

# 17. The Finding Data Model

Recommended structure:

```ts
interface ReviewFinding {
  id: string;

  pillar:
    | "FUNCTIONAL_CORRECTNESS"
    | "SECURITY_PRIVACY"
    | "RELIABILITY"
    | "DATA_INTEGRITY"
    | "PERFORMANCE"
    | "ARCHITECTURE"
    | "TESTING"
    | "OBSERVABILITY";

  checkId: string;

  severity:
    | "CRITICAL"
    | "MAJOR"
    | "MINOR"
    | "TRIVIAL"
    | "INFO";

  confidence: number;

  file: string;
  startLine: number;
  endLine: number;

  title: string;

  problem: string;
  consequence: string;

  evidence: Evidence[];

  recommendation: string;

  suggestedPatch?: string;

  introducedBySha: string;

  status:
    | "OPEN"
    | "RESOLVED"
    | "DISMISSED"
    | "FALSE_POSITIVE";

  detector: string[];

  fingerprint: string;
}
```

`fingerprint` is important for:

- deduplication,
- incremental reviews,
- resolved/reopened state,
- preventing repeated comments on every push.

---

# 18. Only Review What the Push Introduced

This is one of the most important product rules.

Classify findings as:

```text
NEW
MODIFIED
EXISTING
RESOLVED
```

For push/PR inline comments, generally show only:

```text
NEW
MODIFIED
```

Existing repository debt should live separately under something like:

```text
Repository Health
Technical Debt
Baseline Findings
```

Otherwise, a developer changing one button may receive comments about old unrelated vulnerabilities.

That destroys trust.

---

# 19. Correct Incremental Git Logic

Store:

```text
repositoryId
branch
lastReviewedSHA
currentSHA
reviewId
```

Normal flow:

```text
lastReviewedSHA
      ↓
currentSHA
      ↓
git diff <old>..<new>
```

Do not assume:

```text
HEAD~1..HEAD
```

because one push may contain multiple commits.

Handle:

- first push,
- multiple commits,
- rebases,
- force push,
- merge commits,
- branch recreation,
- branch deletion.

When necessary:

```bash
git merge-base <base> <head>
```

Then calculate the correct review scope.

---

# 20. AST and Code Structure Should Be Foundational

Do not treat code as plain text only.

Useful parsers:

- Tree-sitter,
- ast-grep,
- language compiler APIs,
- TypeScript compiler,
- Python AST,
- Java parser,
- Go parser.

Represent code as structures:

```text
File
 ├── Imports
 ├── Exports
 ├── Class
 │    ├── Method
 │    └── Field
 └── Function
      ├── Parameters
      ├── Calls
      ├── Variables
      └── Return
```

Then the system can ask:

> Which functions changed?

instead of only:

> Which lines changed?

---

# 21. Build a Change-Impact Graph

Example:

```text
auth.controller
      ↓
auth.service   ← CHANGED
      ↓
user.repository
      ↓
Prisma
      ↓
User schema
```

Or:

```text
CheckoutButton.tsx
      ↓
useCheckout()
      ↓
POST /checkout
      ↓
checkout.controller
      ↓
payment.service
```

The reviewer does not need the full repository.

It needs the **relevant neighborhood around the changed behavior**.

Potential graph edges:

```text
imports
calls
implements
extends
reads
writes
publishes
consumes
routes-to
schema-for
tested-by
configured-by
```

---

# 22. Deterministic Tools First, AI Second

If a deterministic tool can confidently detect a problem, do not spend expensive reasoning tokens rediscovering it.

Example tooling:

| Area | Tool Examples |
|---|---|
| JS/TS quality | ESLint, Biome |
| Python | Ruff |
| Static security | Semgrep |
| Secrets | Gitleaks |
| Dependencies | OSV Scanner |
| AST rules | ast-grep |
| Types | TypeScript compiler |
| Unit/integration tests | Jest, Vitest, Pytest |
| AI reasoning | LLM reviewer |

Possible future additions:

- CodeQL,
- Trivy,
- npm audit,
- pip-audit,
- dependency graph tools,
- database migration checks.

---

# 23. Do Not Publish Every Tool Finding

Suppose:

```text
ESLint: 147 findings
Semgrep: 12 findings
AI reviewer: 8 findings
```

Do not post 167 comments.

Normalize findings through:

```text
Raw Finding
    ↓
Normalization
    ↓
Pillar Mapping
    ↓
Severity
    ↓
Changed-Code Relevance
    ↓
Deduplication
    ↓
Confidence
    ↓
Publishing Policy
```

If ESLint, Semgrep, and the AI all identify the same root issue, publish **one** finding with multiple evidence sources.

---

# 24. Investigator and Verifier

A very useful architecture is to separate:

## Investigator

Goal:

> Find plausible problems.

Optimize for **recall**.

It may generate more candidates than will ultimately be published.

## Verifier

Goal:

> Try to prove each important candidate wrong.

Optimize for **precision**.

Give the verifier:

```text
candidate finding
changed code
surrounding function
caller
callee
schema
type definition
related tests
repository rules
deterministic evidence
```

Questions:

```text
Can this execution path really occur?

Is validation already performed upstream?

Is authorization enforced elsewhere?

Does this code run only in tests?

Did the problem already exist before this push?

Is there counter-evidence?

Is the behavior intentional according to repository rules?

Can the claimed impact actually happen?
```

Structured verifier result:

```json
{
  "valid": true,
  "confidence": 0.93,
  "evidence": [],
  "counterEvidence": [],
  "reasoningSummary": "..."
}
```

---

# 25. Do Not Verify Everything

A naive architecture:

```text
Main LLM
+
Verifier LLM
```

for every file will roughly double inference cost.

Use selective verification.

Example:

```text
Critical finding
→ verify

Major finding
→ verify if confidence is below threshold

Security finding
→ verify

Low-confidence functional finding
→ verify

Minor readability finding
→ do not verify

Deterministic compiler error
→ probably no verifier required
```

---

# 26. PR-Agent Cost Optimization — Key Lessons

Reference:

- https://docs.pr-agent.ai/core-abilities/#cost-optimization
- https://docs.pr-agent.ai/core-abilities/compression_strategy/
- https://docs.pr-agent.ai/core-abilities/dynamic_context/
- https://docs.pr-agent.ai/core-abilities/self_reflection/
- https://docs.pr-agent.ai/tools/review/

The most important PR-Agent idea is **not** simply “compress tokens.”

The broader philosophy is:

> Use a compact, relevant representation of the PR and make as few expensive model calls as possible.

---

# 27. PR-Agent: Do Not Send the Whole Repository

Conceptually:

```text
Changed File
   ↓
Relevant Patch
   ↓
Small amount of context
   ↓
LLM
```

instead of:

```text
Entire Repository
   ↓
LLM
```

This provides large savings in:

- token cost,
- latency,
- model attention,
- irrelevant context.

---

# 28. PR-Agent: Large PR Compression

When changes exceed the context budget, use graceful compression.

Conceptually:

```text
All Changed Files
      ↓
Remove non-code / binary content
      ↓
Prioritize main repository languages
      ↓
Prioritize relevant additions
      ↓
Compress deletion-heavy hunks
      ↓
Fit highest-value patches first
```

A good principle:

> **Reduce resolution instead of failing.**

Suggested levels:

```text
Level 1 → full changed function
Level 2 → changed hunk
Level 3 → function/class signature
Level 4 → file metadata only
Level 5 → omit
```

---

# 29. PR-Agent: Token Counting Before LLM Calls

Never blindly build a prompt.

Use an explicit token budget.

Example:

```ts
const INPUT_BUDGET = 24_000;

let usedTokens = basePromptTokens;

for (const patch of rankedPatches) {
    const tokens = countTokens(patch);

    if (usedTokens + tokens <= INPUT_BUDGET) {
        includeFullPatch(patch);
        usedTokens += tokens;
    } else {
        includeCompressedMetadata(patch);
    }
}
```

Every context source should have a maximum token budget.

---

# 30. PR-Agent: Dynamic Context

A fixed `10 lines before + 10 lines after` approach is not ideal.

Useful context often depends on code structure.

Prefer:

```text
Changed line
   ↓
Surrounding function
   ↓
Surrounding class
   ↓
Relevant preceding state/inputs
```

The context before a changed statement may be more valuable than the same number of lines after it because it often contains:

- parameters,
- authentication information,
- variable initialization,
- current state,
- permissions,
- prior conditions.

---

# 31. Avoid the Needle-in-the-Haystack Problem

Bigger context windows do not automatically mean better review quality.

Too much context can:

- increase token cost,
- increase latency,
- dilute model attention,
- hide the actual change,
- increase false positives,
- cause the model to reason about unrelated code.

Therefore:

```text
Relevant context > maximum context
```

---

# 32. Limit the Number of Findings

The product should not optimize for maximum comment count.

Prefer:

```text
Critical → always report
Major → report
Minor → only highest-value
Trivial → usually summary
Info → usually suppress
```

A possible cap:

```text
Critical: up to 5
Major:    up to 5
Minor:    up to 3
Trivial:  summary only
Info:     suppressed unless requested
```

This cap can be repository-configurable.

---

# 33. Pillars Should Be Rubric Modules, Not Separate Expensive Agents

Conceptually, you may have:

```text
Security Agent
Correctness Agent
Reliability Agent
Performance Agent
...
```

But do **not** necessarily implement these as eight separate LLM calls.

Instead store each pillar as a reusable rubric module.

Example structure:

```text
/pillars
  functional.ts
  security.ts
  reliability.ts
  data-integrity.ts
  performance.ts
  architecture.ts
  testing.ts
  observability.ts
```

Interface:

```ts
interface ReviewPillar {
  id: string;

  triggers: ChangeTrigger[];

  checks: ReviewCheck[];

  priority: number;

  promptInstructions: string;

  deterministicRules: Rule[];

  contextNeeds: ContextRequirement[];
}
```

Example:

```ts
const securityPillar = {
  id: "SECURITY_PRIVACY",

  triggers: [
    "AUTH_CODE",
    "API_ENDPOINT",
    "USER_INPUT",
    "DATABASE_QUERY",
    "FILE_UPLOAD",
    "EXTERNAL_URL"
  ],

  contextNeeds: [
    "CALLERS",
    "AUTH_MIDDLEWARE",
    "VALIDATORS",
    "SCHEMA"
  ],

  checks: [
    "AUTHENTICATION",
    "AUTHORIZATION",
    "IDOR",
    "INJECTION",
    "SSRF",
    "SECRET_EXPOSURE"
  ]
};
```

---

# 34. The Change Classifier

Before expensive review, classify the push.

Example output:

```json
{
  "changeTypes": [
    "AUTHENTICATION",
    "API"
  ],
  "risk": "HIGH",
  "pillars": [
    "SECURITY_PRIVACY",
    "FUNCTIONAL_CORRECTNESS",
    "RELIABILITY",
    "TESTING"
  ]
}
```

Possible change types:

```text
DOCS
STYLE
UI
BUSINESS_LOGIC
API
AUTHENTICATION
AUTHORIZATION
DATABASE
MIGRATION
PAYMENT
QUEUE
CACHE
FILE_UPLOAD
EXTERNAL_INTEGRATION
CONFIGURATION
INFRASTRUCTURE
TEST
DEPENDENCY
CONCURRENCY
```

---

# 35. Risk Routing

Assign a baseline risk by file/change type.

Example:

| Change | Base Risk |
|---|---:|
| README / docs | 0 |
| pure style / CSS | 1 |
| test-only | 1 |
| React component | 2 |
| domain service | 3 |
| API controller | 4 |
| auth | 5 |
| payment | 5 |
| migration | 5 |
| CI/CD secret/security config | 5 |

Possible modifiers:

```text
+2 authentication changed
+2 authorization changed
+2 DB migration
+2 external payment
+1 public API contract changed
+1 >500 changed lines
+1 concurrency logic changed
+1 dependency upgrade

-1 test-only
-2 docs-only
```

Routing policy:

```text
Risk <= 1
→ deterministic checks only

Risk 2–3
→ cheaper/fast LLM

Risk 4–5
→ stronger review model

Risk >= 6
→ stronger model + verifier
```

---

# 36. Model Routing

Use different model classes based on risk.

Conceptually:

```text
LOW RISK
→ cheap / fast model

MEDIUM RISK
→ balanced model

HIGH RISK
→ strong reasoning model

CRITICAL CANDIDATE
→ strong reasoning model
   +
   verifier
```

Avoid:

```text
CSS change
→ most expensive reasoning model
```

---

# 37. Context Ranking

Every context item should receive a relevance score.

Possible scoring model:

```text
context_score =
0.30 × change_proximity
+ 0.25 × call_graph_relation
+ 0.20 × risk_level
+ 0.15 × symbol_relation
+ 0.10 × test_relation
```

Then:

```text
rank context
   ↓
fill token budget
   ↓
stop when budget is reached
```

---

# 38. Example Token Budget

```yaml
review_budget:
  total_input: 24000

  system_rules: 2500
  diff: 10000
  surrounding_context: 5000
  dependencies: 2500
  repository_rules: 1500
  historical_context: 1000
  reserve: 1500
```

These values should be configurable by model.

---

# 39. Repository-Specific Path Rules

Different folders should activate different checks.

Example:

```yaml
review:
  paths:

    "src/controllers/**":
      focus:
        - authentication
        - authorization
        - input_validation
        - data_exposure

    "src/services/**":
      focus:
        - business_logic
        - transactions
        - error_handling
        - concurrency

    "prisma/**":
      focus:
        - schema_compatibility
        - migration_safety
        - data_loss

    "tests/**":
      focus:
        - edge_cases
        - meaningful_assertions
        - regression_coverage
```

This reduces irrelevant prompts and false positives.

---

# 40. Repository Review Configuration

Support repository-level guidance files such as:

```text
.codereview.yml
REVIEW.md
AGENTS.md
```

Example:

```yaml
architecture:
  controller_database_access: forbidden
  repository_pattern: required

security:
  authorization_service: PermissionService
  allow_console_log: false

api:
  breaking_changes_require_versioning: true

quality:
  max_function_complexity: 15
```

This helps the reviewer reason according to the codebase's actual standards.

---

# 41. Developer Feedback and Learning

Every finding should support feedback:

```text
Useful
False Positive
Ignore Once
Ignore Rule
Ignore for Path
Accepted
Resolved
```

Store:

```text
repository
path
pillar
checkId
finding fingerprint
developer decision
dismiss reason
rule exception
```

Use future feedback as **context**, not absolute truth.

A developer dismissing a real security finding does not automatically make that rule invalid.

---

# 42. Deduplication

Multiple detectors may detect the same root problem.

Fingerprint should consider:

```text
repository
file
symbol
checkId
semantic issue type
normalized location
```

The goal:

```text
ESLint finding
+
Semgrep finding
+
AI finding
=
ONE final review issue
```

---

# 43. Comment Format

Avoid long AI essays.

Every inline finding should answer:

```text
WHAT?
WHY?
IMPACT?
FIX?
```

Recommended format:

> **🔴 Major · Functional Correctness**
>
> **Possible duplicate charge on retry**
>
> `createPayment()` creates the Stripe charge before persisting the idempotency record. If the DB write fails and the request is retried, the customer may be charged twice.
>
> **Suggested fix:** persist/retrieve an idempotency key before the charge and reuse it across retries.

---

# 44. Review Summary

A PR/push-level summary could look like:

```text
Review Summary

Critical: 0
Major:    2
Minor:    3

Top Risks
1. Authorization gap in user deletion flow
2. Non-idempotent payment retry
3. Missing regression test for changed validation
```

Optional dashboard pillar scores:

```text
Functional Correctness    82
Security & Privacy        96
Reliability               74
Data Integrity            90
Performance               86
Architecture              77
Testing                   65
Observability             88
```

But the merge decision should use actual findings and policies.

---

# 45. Pre-Merge Policy Should Be Separate

Example:

```yaml
merge_policy:

  block_on:
    critical: true

  major:
    max_allowed: 3

  security:
    minimum_severity_to_block: major

  tests:
    require_for_business_logic_changes: true

  quality:
    minimum_score: 75
```

Review says:

> There is a problem.

Policy says:

> Is this allowed to merge?

Those are different responsibilities.

---

# 46. Full Push Review Architecture

```text
                        GITHUB
                           │
                           │ push / PR webhook
                           ▼
                  ┌─────────────────┐
                  │ Webhook Gateway │
                  └────────┬────────┘
                           │
                           ▼
                   Verify Signature
                           │
                           ▼
                    Create Review Job
                           │
                           ▼
                        Queue
                           │
                           ▼
                   Clone / Fetch Repo
                           │
                           ▼
                Determine Review Baseline
                           │
                previous SHA → current SHA
                           │
                           ▼
                        Git Diff
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
       Changed Files                 Repo Metadata
            │                             │
            └──────────────┬──────────────┘
                           ▼
                   Change Classifier
                           │
                           ▼
                      Risk Router
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
   Deterministic Analysis             AST / Graph
            │                             │
            └──────────────┬──────────────┘
                           ▼
                    Context Builder
                           │
                           ▼
                 Relevant Pillar Selection
                           │
                           ▼
                   Token Budget Manager
                           │
                           ▼
                  Main AI Review Call
                           │
                           ▼
                  Candidate Findings
                           │
                           ▼
                Normalize / Deduplicate
                           │
                           ▼
                   Risk / Confidence
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
      Normal Findings            High-Risk / Uncertain
            │                             │
            │                             ▼
            │                      Verifier LLM
            │                             │
            └──────────────┬──────────────┘
                           ▼
                    Final Findings
                           │
                           ▼
                  Publishing Policy
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
     Inline Comments                 Review Summary
           │                               │
           └───────────────┬───────────────┘
                           ▼
                    GitHub Check Status
                           │
                           ▼
                      Dashboard
```

---

# 47. Recommended Production Layering

## Layer 1 — Event Layer

Responsibilities:

```text
GitHub App
Webhook signature validation
Push / PR detection
Review job creation
Queueing
Idempotency
Retry strategy
```

---

## Layer 2 — Git Intelligence

Responsibilities:

```text
baseline SHA
head SHA
merge base
changed files
changed hunks
renames
deletions
added files
commit metadata
```

---

## Layer 3 — Code Intelligence

Responsibilities:

```text
AST
symbols
imports
exports
function boundaries
class boundaries
call graph
dependency graph
schemas
related tests
```

---

## Layer 4 — Deterministic Analysis

Responsibilities:

```text
linters
type checker
SAST
secret scan
dependency scan
AST rules
test results
```

---

## Layer 5 — Context Retrieval

Potential context:

```text
changed function
caller
callee
auth middleware
schema
DTO
test
repository rules
related historical decision
```

Only retrieve what is useful for the activated pillars.

---

## Layer 6 — AI Review

Responsibilities:

```text
functional reasoning
security data-flow reasoning
reliability reasoning
contract reasoning
performance reasoning
architecture reasoning
test-gap reasoning
```

Prefer one main structured review call where practical.

---

## Layer 7 — Verification

Responsibilities:

```text
reachability check
counter-evidence search
existing protection
upstream/downstream validation
test-only detection
pre-existing issue detection
confidence adjustment
```

---

## Layer 8 — Risk Engine

Responsibilities:

```text
pillar
check ID
severity
confidence
fingerprint
introduced-by classification
```

---

## Layer 9 — Delivery

Responsibilities:

```text
inline comment
summary
GitHub check
merge policy result
dashboard
suggested patch
```

---

## Layer 10 — Learning

Responsibilities:

```text
accepted findings
dismissed findings
false-positive reasons
path exceptions
repository rules
team preferences
historical findings
```

---

# 48. Cost-Aware Production Architecture

Combining the strongest ideas from the discussion:

```text
Git Diff
   ↓
Structural Parsing
   ↓
Deterministic Scanners
   ↓
Change / Risk Classifier
   ↓
Relevant Context Retrieval
   ↓
Relevant Pillar Selection
   ↓
Token-Aware Compression
   ↓
ONE MAIN REVIEW CALL
   ↓
Candidate Findings
   ↓
Severity + Confidence
   ↓
Verify only High-Risk / Uncertain Candidates
   ↓
Deduplicate
   ↓
Final Findings
```

This combines:

- PR-Agent-style affordability,
- CodeRabbit-style contextual reasoning,
- verification for precision,
- repository-aware policy,
- incremental review,
- deterministic tooling.

---

# 49. Example Review — Authorization Bug

Changed code:

```ts
async function deleteUser(userId: string) {
  return prisma.user.delete({
    where: { id: userId }
  });
}
```

Context engine retrieves:

```text
user.service.ts::deleteUser        ← changed
user.controller.ts::deleteUser
auth.middleware.ts
schema.prisma::User
user.service.test.ts
```

Security/context analysis may discover:

```text
Controller accepts arbitrary userId
        ↓
Authentication confirms only identity
        ↓
No resource ownership check
        ↓
No admin-role requirement
        ↓
Service deletes arbitrary user
```

Finding:

```text
Pillar: Security & Privacy
Check: Broken Object Authorization / IDOR
Severity: Critical
Confidence: High
```

The AI did not need the entire repository.

It needed the relevant execution path.

---

# 50. Example Review — Database N+1

Changed code:

```ts
for (const learner of learners) {
  const progress = await prisma.progress.findMany({
    where: { learnerId: learner.id }
  });
}
```

Relevant pillar:

```text
Performance & Scalability
```

Potential finding:

> This introduces one progress query per learner. A list of 1,000 learners may cause roughly 1,001 queries for a single request. Fetch progress for all learner IDs in one query and group in memory.

Verifier may check:

- expected learner list size,
- whether this path is paginated,
- whether Prisma batches the call,
- whether result is already cached.

---

# 51. Example Review — Payment Reliability

Changed flow:

```text
Create payment
 ↓
Persist order
```

If payment succeeds and database persistence fails:

```text
Customer charged
but
order missing
```

Relevant pillars:

```text
Reliability
Data Integrity
Functional Correctness
```

Potential recommendation:

```text
idempotency key
transaction / saga
compensating operation
persistent payment intent
retry-safe workflow
```

---

# 52. Suggested Review Engine Internal Modules

Possible backend structure:

```text
review-engine/
│
├── git/
│   ├── diff-service
│   ├── merge-base
│   └── change-parser
│
├── intelligence/
│   ├── ast
│   ├── symbols
│   ├── call-graph
│   ├── dependency-graph
│   └── test-mapper
│
├── detectors/
│   ├── eslint
│   ├── semgrep
│   ├── gitleaks
│   ├── osv
│   └── ast-grep
│
├── classification/
│   ├── change-classifier
│   └── risk-router
│
├── pillars/
│   ├── functional
│   ├── security
│   ├── reliability
│   ├── data-integrity
│   ├── performance
│   ├── architecture
│   ├── testing
│   └── observability
│
├── context/
│   ├── context-builder
│   ├── context-ranker
│   └── token-budget
│
├── ai/
│   ├── primary-reviewer
│   ├── verifier
│   └── model-router
│
├── findings/
│   ├── normalizer
│   ├── severity-engine
│   ├── confidence-engine
│   ├── deduplicator
│   └── fingerprint
│
├── policies/
│   └── merge-policy
│
├── delivery/
│   ├── github-comments
│   ├── github-checks
│   └── summary
│
└── learning/
    ├── feedback
    └── repository-rules
```

---

# 53. Suggested Execution Logic

Pseudo-flow:

```ts
async function reviewPush(event) {
  const baseline = await resolveBaseline(event);
  const diff = await buildDiff(baseline, event.headSha);

  const changes = await parseChanges(diff);

  const deterministicResults =
    await runApplicableDetectors(changes);

  const classification =
    await classifyChanges(changes, deterministicResults);

  if (classification.risk === "NONE") {
    return publishDeterministicSummary();
  }

  const pillars =
    selectPillars(classification);

  const contextCandidates =
    await retrieveRelevantContext({
      changes,
      pillars
    });

  const context =
    fitContextToBudget(
      rankContext(contextCandidates)
    );

  const review =
    await runPrimaryReview({
      changes,
      context,
      pillars,
      deterministicResults
    });

  let findings =
    normalizeFindings(review, deterministicResults);

  findings =
    deduplicate(findings);

  findings =
    classifyIntroducedState(findings, baseline);

  findings =
    calculateSeverity(findings);

  findings =
    calculateConfidence(findings);

  const verifyCandidates =
    selectVerificationCandidates(findings);

  const verified =
    await verifyFindings(verifyCandidates);

  findings =
    mergeVerification(findings, verified);

  findings =
    applyPublishingPolicy(findings);

  await publishReview(findings);
}
```

---

# 54. What NOT to Do

Avoid these designs:

## 1. Giant General Prompt

```text
Here is the diff.
Check security, bugs, performance, architecture,
testing, quality, reliability, documentation...
```

Problems:

- unfocused,
- expensive,
- inconsistent,
- false-positive prone,
- poor coverage of complex execution paths.

---

## 2. Eight LLM Calls for Every Push

```text
Security Agent
Correctness Agent
Reliability Agent
Data Agent
Performance Agent
Architecture Agent
Testing Agent
Observability Agent
```

executed on every README/CSS/small change.

Problems:

- expensive,
- slow,
- repetitive,
- duplicate findings.

Use pillar routing instead.

---

## 3. Whole-Repository Context Every Time

Problems:

- high cost,
- attention dilution,
- latency,
- irrelevant analysis.

Use graph-based relevant context.

---

## 4. Publish Every Detected Issue

Problems:

- noise,
- developer fatigue,
- false-positive damage,
- low trust.

Rank and cap output.

---

## 5. Let the LLM Decide Everything

Do not rely on AI alone for:

- line mappings,
- token counting,
- compiler/type errors,
- basic lint,
- secret scans,
- severity formula,
- merge policy,
- duplicate identification,
- baseline comparison.

Use deterministic systems where possible.

---

# 55. Recommended MVP → Advanced Roadmap

## Phase 1 — Solid MVP

Build:

```text
GitHub webhook
Diff extraction
Changed-file classification
ESLint / Ruff
Semgrep
Secret scan
One LLM review
5–8 review pillars
Structured findings
Inline comments
Review summary
```

---

## Phase 2 — Precision

Add:

```text
AST parsing
changed-function detection
severity engine
confidence engine
deduplication
introduced-by-this-push detection
path-specific rules
```

---

## Phase 3 — Repository Intelligence

Add:

```text
call graph
dependency graph
schema mapping
test mapping
context ranking
token-budget system
repository review config
```

---

## Phase 4 — Advanced AI

Add:

```text
risk-based model routing
selective verifier
security path investigation
dynamic context retrieval
cross-file reasoning
suggested patches
```

---

## Phase 5 — Learning & Enterprise Policy

Add:

```text
developer feedback
false-positive learning
team policies
merge gates
repository health
historical trends
analytics
custom review rules
organization-level standards
```

---

# 56. Recommended Product Metrics

Track more than raw finding count.

## Precision Metrics

```text
Finding acceptance rate
False-positive rate
Dismissal rate
Developer agreement rate
```

## Efficiency Metrics

```text
Tokens per review
Cost per push
Latency per review
LLM calls per review
Context utilization
```

## Quality Metrics

```text
Critical issues detected
Major issues detected
Issues fixed before merge
Repeated issue rate
Reopened issue rate
```

## Noise Metrics

```text
Comments per PR
Suppressed findings
Duplicate findings removed
Low-confidence findings filtered
```

---

# 57. Final Recommended Philosophy

The entire product can be summarized as:

```text
PILLARS
= What kinds of risk matter?

CHECKS
= What exactly should be tested?

DETECTORS
= What can deterministic tools prove?

CONTEXT
= What code is required to understand the change?

ROUTING
= Which pillars/models should run?

AI
= What requires semantic reasoning?

VERIFICATION
= Is the candidate issue actually true?

SEVERITY
= How dangerous is it?

CONFIDENCE
= How sure are we?

DEDUPLICATION
= Is this already represented?

BASELINE
= Was it introduced by this push?

POLICY
= Should this warn or block?

FEEDBACK
= What should future reviews know?
```

The central rule should be:

> **Never spend an LLM token unless that token materially increases the probability of identifying a real issue introduced by the current change.**

And the core production pipeline should be:

```text
Detect
  ↓
Understand
  ↓
Route
  ↓
Retrieve Context
  ↓
Analyze
  ↓
Verify
  ↓
Rank
  ↓
Deduplicate
  ↓
Report
```

This architecture gives you a code review engine that is:

- more accurate,
- cheaper,
- faster,
- easier to scale,
- less noisy,
- easier to explain,
- more trusted by developers,
- and much stronger than a simple “LLM reviews Git diff” implementation.

---

# 58. Useful References

## CodeRabbit

- Architecture  
  https://docs.coderabbit.ai/overview/architecture

- Code Review Overview  
  https://docs.coderabbit.ai/guides/code-review-overview

- Security Agent  
  https://docs.coderabbit.ai/security-agent

- Tools  
  https://docs.coderabbit.ai/tools

- Path Instructions  
  https://docs.coderabbit.ai/configuration/path-instructions

- AST-grep Instructions  
  https://docs.coderabbit.ai/configuration/ast-grep-instructions

- Knowledge Base  
  https://docs.coderabbit.ai/knowledge-base

- Learnings  
  https://docs.coderabbit.ai/knowledge-base/learnings

- Pre-Merge Checks  
  https://docs.coderabbit.ai/pr-reviews/pre-merge-checks

## PR-Agent

- Core Abilities / Cost Optimization  
  https://docs.pr-agent.ai/core-abilities/#cost-optimization

- Compression Strategy  
  https://docs.pr-agent.ai/core-abilities/compression_strategy/

- Dynamic Context  
  https://docs.pr-agent.ai/core-abilities/dynamic_context/

- Self Reflection  
  https://docs.pr-agent.ai/core-abilities/self_reflection/

- Review Tool  
  https://docs.pr-agent.ai/tools/review/

---

# 59. Final Architecture Snapshot

```text
                         ┌──────────────────┐
                         │   GitHub Push    │
                         └────────┬─────────┘
                                  │
                                  ▼
                         Webhook Validation
                                  │
                                  ▼
                         Baseline Resolution
                                  │
                                  ▼
                              Git Diff
                                  │
                                  ▼
                         Change Classification
                                  │
                                  ▼
                              Risk Score
                                  │
             ┌────────────────────┴────────────────────┐
             ▼                                         ▼
      Deterministic Tools                       Code Intelligence
             │                                   AST / Graph / Tests
             └────────────────────┬────────────────────┘
                                  ▼
                          Relevant Pillars
                                  │
                                  ▼
                         Context Retrieval
                                  │
                                  ▼
                         Context Ranking
                                  │
                                  ▼
                         Token Compression
                                  │
                                  ▼
                          Main LLM Review
                                  │
                                  ▼
                        Candidate Findings
                                  │
                                  ▼
                      Normalize + Deduplicate
                                  │
                                  ▼
                      Severity + Confidence
                                  │
                ┌─────────────────┴─────────────────┐
                ▼                                   ▼
        High Confidence                      High Risk / Uncertain
                │                                   │
                │                                   ▼
                │                           Verification LLM
                │                                   │
                └─────────────────┬─────────────────┘
                                  ▼
                           Final Findings
                                  │
                                  ▼
                        Publishing / Merge Policy
                                  │
                ┌─────────────────┼──────────────────┐
                ▼                 ▼                  ▼
          Inline Comments    Review Summary      GitHub Check
                │                 │                  │
                └─────────────────┴──────────────────┘
                                  │
                                  ▼
                              Dashboard
                                  │
                                  ▼
                          Developer Feedback
                                  │
                                  ▼
                       Future Review Context
```

---

**Document status:** Consolidated technical design from the complete discussion on production-grade push-based AI code review.
