import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type * as Zod from "zod/v4";

/**
 * QOL-001: agent-facing goal tool.
 *
 * Registers a tool named `goal` that SHADOWS the hidden built-in goal tool.
 * The host captures the native implementation before extension tools replace
 * registry entries, so `ctx.invokeTool` delegates every op to the native
 * GoalTool — preserving GoalRuntime state, session persistence, budget
 * accounting, and goal_updated events exactly. The extension tool is active
 * by default, which is the whole point: the agent can view and manipulate
 * the session goal at any time without the user entering goal mode first.
 *
 * Design: docs/plans/designs/qol-001-agent-goal-tool-design.md
 * ADR: docs/ssot/adrs/ADR-001-goal-tool-shadow-delegate.md
 */

export const GOAL_TOOL_NAME = "goal";

/** Marker prefix used to identify our entry in RPC `dumpTools` output. */
export const GOAL_TOOL_MARKER = "[qol]";

export const NATIVE_UNAVAILABLE_MESSAGE =
	"Goal operations are unavailable in this session: the host did not create the native goal tool. " +
	'Ask the user to enable the `goal.enabled` setting (omp settings) and restart the session. ' +
	"The user can also manage goals manually with the /goal command.";

export const GOAL_TOOL_DESCRIPTION = `${GOAL_TOOL_MARKER} View and manage this session's goal. ` +
	"Ops: create (start a goal; requires objective, optional token_budget), " +
	"get (show current goal status and usage), " +
	"complete (mark the goal achieved), " +
	"resume (resume a paused goal), " +
	"drop (abandon the goal). " +
	"Only one non-terminal goal may exist per session; create fails while one is active or paused.";

export function registerGoalTool(pi: ExtensionAPI): void {
	// Real zod (root barrel exports it as `zod`) via the host's OWN injected
	// namespace — no bare host imports, which the sealed installed binary
	// cannot resolve from the plugin cache copy. Fall back to `pi.zod` for
	// mocks/source hosts without the injected surface.
	const injectedRoot = (pi as unknown as { pi?: { zod?: unknown } }).pi;
	const z = (injectedRoot?.zod ?? pi.zod) as typeof Zod;

	pi.registerTool({
		name: GOAL_TOOL_NAME,
		label: "Goal",
		description: GOAL_TOOL_DESCRIPTION,
		// Goal ops only mutate session bookkeeping; the native built-in itself
		// runs ungated, so keep this off the approval prompt (see ADR-001).
		approval: "read",
		// Extension tools default to "discoverable", which keeps them OUT of the
		// top-level schema sent to the model. The whole point of QOL-001 is that
		// the agent can always call this tool, so pin it to the essential set.
		loadMode: "essential",
		parameters: z.object({
			op: z
				.enum(["create", "get", "complete", "resume", "drop"])
				.describe("Goal operation to perform"),
			objective: z
				.string()
				.optional()
				.describe("Objective text; required for op=create"),
			token_budget: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Optional token budget for op=create; positive integer"),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const args = params as Record<string, unknown>;
			const op = String(args.op);

			// Unified JSON envelope, same shape as the advisor and mode tools:
			//   success: { ok:true,  tool:"goal", op, message, details?, warnings: [] }
			//   failure: { ok:false, tool:"goal", op, error, action? }
			const fail = (error: string, action?: string) => {
				const body: Record<string, unknown> = { ok: false, tool: GOAL_TOOL_NAME, op, error };
				if (action) body.action = action;
				return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }], details: body, isError: true };
			};

			if (signal?.aborted) return fail("Cancelled: the tool call was aborted before it ran.");

			const invoke = ctx.invokeTool;
			if (!invoke) {
				// Host has no native goal tool of this name (goal.enabled off,
				// restricted tool mode, or older host). Fail with guidance, not a throw.
				return fail(NATIVE_UNAVAILABLE_MESSAGE);
			}

			try {
				// Same-tool delegation: runs the native goal tool with its own
				// session wiring; inherits this call's approval, not re-gated.
				const result = await invoke(args, { signal, onUpdate });
				const text = (result.content ?? [])
					.filter((block): block is { type: "text"; text: string } => block?.type === "text")
					.map(block => block.text)
					.join("\n");
				if (result.isError) return fail(text || `goal ${op} failed.`);
				const body: Record<string, unknown> = { ok: true, tool: GOAL_TOOL_NAME, op, message: text };
				if (result.details !== undefined) {
					// Keep the native details in the envelope when serializable.
					try {
						JSON.stringify(result.details);
						body.details = result.details;
					} catch {
						/* non-serializable native details stay out of the JSON body */
					}
				}
				body.warnings = [];
				return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }], details: body };
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				return fail(`goal ${op} failed: ${detail}`);
			}
		},
	});
}
