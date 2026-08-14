# Uncertainty Register

Status vocabulary:

- **CLOSED** — current upstream source closes the question.
- **STRONG** — architecture is strongly supported; runtime probe/e2e still useful.
- **OPEN** — evidence missing and could alter design.
- **DEFER** — intentionally not resolved until a lower-level primitive is proven.
- **DISPROVEN** — an assumption in the original proposal is no longer true on current upstream.

| Area | Original / implied assumption | Current status | Evidence / reasoning | Consequence |
|---|---|---|---|---|
| OMP research version | 17.2.4/17.2.8 behavior is current enough | **DISPROVEN** | inspected upstream is coding-agent 17.2.12 | Delta-check all lifecycle conclusions |
| Goal | agent cannot cleanly drive goal | **CLOSED** | existing QOL-001 + native delegation design | Maintenance only |
| Plan/Vibe | may require emulation | **CLOSED** | ADR-004 + host-native surfaces | Never reintroduce emulation fallback silently |
| Advisor config hot apply | new WATCHDOG edits may require restart | **DISPROVEN** | native configure save path re-discovers and `applyAdvisorConfigs` rebuilds live roster | Build thin agent-facing CRUD/apply |
| Advisor toggle as refresh | off/on might rediscover WATCHDOG | **CLOSED: no** | enable/disable is separate from config discovery/apply | Toggle cannot substitute for apply |
| Extension `ctx.reload()` | may refresh plugin/config state | **DISPROVEN** | it reopens/switches the current session file | Never market as generic reload |
| Task agent definition refresh | `.omp/agents/*.md` needs explicit refresh | **DISPROVEN** | task preflight re-runs agent discovery each spawn | Definition edits apply next spawn |
| Task model-role refresh | editing config file is enough | **DISPROVEN / dangerous** | spawn resolves from live Settings; file edit does not imply live mutation | Mutate owner + read back effective resolution |
| Skill mutation | no first-class agent self-management | **DISPROVEN** | `manage_skill` exists and active skills can refresh in-session | PrimeStyle should reuse it |
| MCP refresh | generic reload needed | **DISPROVEN** | dedicated reconnect/rediscovery/tool refresh lifecycle exists | Reuse native lifecycle |
| Model catalog refresh | no native refresh | **DISPROVEN** | ModelRegistry has refresh operations | Thin driver possible |
| AGENTS/context files hot apply | necessarily next-session | **DISPROVEN in normal SDK path** | base-prompt rebuild re-discovers context files when not explicitly frozen | Expose live prompt rebuild through a thin host seam; verify |
| SYSTEM.md / APPEND_SYSTEM.md file hot apply | same as AGENTS/context files | **DISPROVEN** | startup resolves these into captured prompt strings; base rebuild reuses them | Treat file edits as next-session/recreate unless owner API is added |
| Extension module hot reload | editing TS updates running instance | **CLOSED conservatively: no supported live contract** | loading is startup-oriented; session reload is unrelated; no proven teardown/re-register API | Restart-class in v1 |
| Context transform persistence | must rewrite session messages or external DB | **DISPROVEN** | `pi.appendEntry` persists extension state without sending it to LLM | Use append-only QOL custom entries |
| Stable DCP addressing | context messages directly expose SessionEntry IDs | **DISPROVEN** | context event has copies only; journal IDs live separately | Provenance/identity seam recommended |
| Stable DCP addressing can rely on content matching | plugin can rebuild native context and match forever | **DISPROVEN as robust contract** | context handlers are serial; installed plugin is not guaranteed first; no handler priority | Add entry-aware early projection/provenance core seam |
| Compress → expand requires copied raw payload | raw text must be stored in block | **DISPROVEN while overlay is unsealed** | canonical journal remains source of truth | Expand can disable active overlay before native sealing |
| Transform-only DCP owns headroom | compressed provider context will postpone native compaction | **DISPROVEN** | OMP compaction pressure is floored by stored-conversation estimate specifically to defeat on-wire compression undercount | Must integrate with native lifecycle: seal/materialize or add core projection-ownership seam |
| Native compaction must always re-summarize DCP history | unavoidable duplicate summary call | **DISPROVEN** | `session_before_compact` can provide a custom `CompactionResult` | Reuse mature DCP summaries when sealing |
| Tool call/result compression | arbitrary range deletion is safe | **DISPROVEN** | provider tool protocol requires valid call/result relationships; modified assistant replay metadata can become stale | Normalize selection to protocol-safe closure + sanitize projected replay state |
| Pin arbitrary source | can replay original message type anywhere | **DISPROVEN for toolResult-like sources** | a standalone raw toolResult can be invalid provider history | Render pinned source as provider-neutral context record |
| Pin location | system prompt is universally best | **OPEN / provider-dependent** | authority vs cache damage vs recency tradeoff | v1 default tail-zone; system explicit |
| Arbitrary mid-history pin | likely useful enough for v1 | **DEFER** | higher ordering + cache cost; no evidence it beats tail | Benchmark later |
| Pin affects compaction | needs compactor fork | **DISPROVEN** | compaction events can add guidance/preserve data; custom compaction is possible | Integrate through native hooks first |
| Pin scope | obvious session-global state | **OPEN** | branch history makes multiple semantics valid | Default branch scope; explicit wider scopes later |
| Pin source identity | one pin type is enough | **OPEN** | source/snapshot/instruction have different lifecycle semantics | Make kind explicit |
| PinStateTree | should be pin core | **DEFER / rejected for v1** | it is policy over pin intents | Build only after flat pin eval |
| Prime-style improvement | unrestricted file edit is key unlock | **DISPROVEN** | Prime Agent is typed/scoped/versioned; OMP already has resource owners | Build Managed Harness Resource adapters |
| Autonomous live extension self-edit | useful v1 Prime feature | **REJECTED** | no safe live reload contract | restart-class only |
| Autonomous global mutation | agent should freely promote if it can edit | **OPEN / quality-risk** | harness research shows credit/regression are central | Candidate→evaluation→promotion→rollback |
| “better harness” self-judgment | model can reliably tell whether its change helped | **DISPROVEN as a reliable assumption** | current self-improvement work separates proposal from evaluation | Evaluation system owns credit |

## P0 questions that still can change architecture

### 1. Provenance / Address Layer seam

Prototype an entry-aware context representation before choosing public message syntax. It must survive:

- branch/tree navigation and resume;
- native compaction/branch summary;
- multi-tool assistant turns;
- hidden/custom messages;
- retries/errors;
- other context transformers before/after QOL.

A permanent content-matching layer is no longer recommended.

### 2. DCP headroom ownership: architecture C or D

The important product decision is now explicit:

- **C: overlay + native CompactionEntry sealing** — mostly plugin-side, practical v1, but exact expand semantics weaken after seal.
- **D: core-supported trusted projection ownership** — more core work, but cleanest fully reversible agent-managed context lifecycle.

Keep A (overlay-only) as baseline and B (cancel gate) as an experiment, not target designs. See `14-P0-CLOSURE-NOTES.md`.

### 3. Advisor live apply bridge

Native save/discover/apply is proven, but standard extension context does not expose the live `AgentSession` apply operation. Reuse the project's existing host namespace if possible; otherwise add one narrow host action.

### 4. Live AGENTS/context prompt rebuild bridge

`AgentSession.refreshBaseSystemPrompt()` is real and re-discovers ordinary context files. Standard extension context does not expose it directly. If PrimeStyle needs live project-instruction activation, bridge precisely this operation rather than a generic reload.

### 5. Sealed block expansion semantics

For architecture C decide whether `expand` after native sealing means:

- temporary provider-neutral rehydration;
- a branch/fork to a pre-seal state;
- or "not exact after seal" with an explicit lifecycle state.

Do not hide this distinction from the model/user.
