# PrimeStyleManagement — Foundation Design

## 1. Reframe

The useful idea from Prime-style harness self-improvement is **not unrestricted self-editing**. The useful idea is that an agent can accumulate and revise durable external behavior artifacts under an explicit lifecycle.

OMP-QOL should expose a **Managed Harness Resource** layer:

```text
inspect → diagnose → propose/mutate → native apply → verify → evaluate → promote/rollback
```

Raw file editing remains an escape hatch, not the system of record.

## 2. Prime Agent precedent

Current Prime Agent continual refinement is bounded and typed. Its refinement domain includes:

- prompt;
- memory;
- skill;
- subagent.

It records scope, versions/history, evidence and outcomes rather than allowing arbitrary mutation of the immutable base harness.

This is a better precedent for OMP-QOL than "let the model edit its own source code."

## 3. OMP already has resource owners

The opportunity is to federate existing OMP primitives behind one introspectable contract.

### Managed skill

- native tool already performs CRUD;
- current session can refresh active skills;
- good first adapter because mutation/apply/readback already exist.

### Task agent definitions

- file-backed definitions are rediscovered every spawn;
- activation boundary is naturally `next_spawn`;
- model override/roles still come from live Settings and must be verified separately.

### Advisor

- WATCHDOG is already a typed configuration surface;
- native configure path re-discovers and hot rebuilds advisor runtimes;
- QOL only needs an agent-callable thin CRUD/apply path.

### Model roles/settings

- owned by live Settings;
- raw YAML writes are insufficient as a live-apply contract;
- adapter should mutate the owner and return resolved concrete model readback.

### Memory

- backend semantics differ;
- adapter must report whether a write affects immediate recall, next request, or next session injection;
- do not flatten local memory, Hindsight and Mnemopi into one fake lifecycle.

### AGENTS/context instructions

- current base-prompt rebuild can re-discover normal context files;
- with a narrow `refreshBaseSystemPrompt()` bridge, this can be a true live project-instruction resource;
- readback should inspect the effective rebuilt prompt/context, not just file contents.

### SYSTEM.md / APPEND_SYSTEM.md

- these are startup-resolved prompt inputs, not equivalent to AGENTS/context files;
- editing the file does not mean an existing session's captured custom/append prompt string changed;
- classify the file resource as `next_session`/session recreate unless a proper owner mutation path is added.

### Extension/plugin code

- no safe supported live teardown/re-register path has been proven;
- v1 may allow source mutation only with `effectiveAt: restart`;
- autonomous mutation of the running QOL engine itself should be disabled by default.

## 4. Resource adapter

```ts
interface ManagedHarnessResource<TSpec, TObserved> {
  kind: string;
  scope: "session" | "project" | "user";

  inspect(): Promise<TObserved>;
  validate(spec: TSpec): Promise<ValidationReport>;
  stage(spec: TSpec): Promise<Revision>;
  apply(revision: string): Promise<ApplyResult>;
  verify(revision: string): Promise<VerificationReport>;
  rollback(revision: string): Promise<ApplyResult>;
}
```

Required metadata:

```ts
interface Revision {
  id: string;
  resourceKind: string;
  scope: string;
  parentRevision?: string;
  diagnosis?: string;
  changeSummary: string;
  evidence?: EvidenceRef[];
  createdAt: string;
  createdByModel?: string;
  state: "candidate" | "promoted" | "rejected" | "rolled-back";
}
```

## 5. Apply must be explicit

Every resource mutation result should distinguish storage from activation:

```ts
{
  persisted: true,
  applied: false,
  effectiveAt: "restart",
  verification: {...}
}
```

is a successful source edit but **not** a live harness change.

This prevents exactly the stale-config failure class described in the original proposal.

## 6. Candidate vs promoted

Do not directly overwrite durable project/user harness state for every self-proposed improvement.

Recommended lifecycle:

```text
failure/weakness observation
        ↓
candidate revision
        ↓
validation + readback
        ↓
local task/eval trial
        ↓
regression gate
        ↓
promoted revision OR rejected/rollback
```

For global/user scope, require a stronger gate than project-local changes.

## 7. Credit assignment is the hard part

The system must separate:

- **updater quality:** can a model propose a plausible improvement?
- **activation correctness:** did the host actually apply what was proposed?
- **consumer benefit:** does the main solver perform better with it?
- **regression:** did unrelated tasks become worse?

The updater's own claim that "this helped" is evidence, not ground truth.

## 8. Evidence record

For each candidate, persist:

```text
diagnosis
→ proposed change
→ intended mechanism
→ activation/readback proof
→ evaluation cases
→ metric deltas
→ observed failures
→ outcome
→ rollback target
```

Keep rejected changes; they are valuable negative evidence and prevent rediscovery loops.

## 9. Safe autonomy tiers

### Tier 0 — inspect only

Agent can inspect all managed resources and effective activation state.

### Tier 1 — session/local candidate mutation

Agent can create candidate local resources and apply low-risk native mutations with rollback.

### Tier 2 — project promotion

Requires verification and regression/eval evidence.

### Tier 3 — user/global promotion

Requires stronger policy gate and explicit rollback/history. Whether human confirmation is mandatory is a product choice, but silent uncontrolled promotion should not be the default.

### Excluded from v1

Live self-edit of the running extension/plugin implementation.

## 10. Suggested adapter implementation order

1. managed skill;
2. task agent definition + model resolution verification;
3. advisor;
4. model role/settings;
5. memory backends;
6. AGENTS/context instruction resource with live prompt rebuild;
7. QOL-owned supplemental instruction resource if needed;
8. only later consider startup/restart resources such as SYSTEM/APPEND or extension source.

This order maximizes reuse of existing native OMP ownership and minimizes false "applied" states.
