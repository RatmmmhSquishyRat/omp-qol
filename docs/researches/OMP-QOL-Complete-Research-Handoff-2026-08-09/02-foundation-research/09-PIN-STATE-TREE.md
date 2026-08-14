# PinStateTree — Control Plane, Not Pin Core

## Reframed role

PinStateTree is a powerful proposal, but it does not solve pin persistence or projection. It is a **policy/state machine that selects a set of pin intents**.

Therefore:

> PinStateTree must depend on the Pin API; the Pin API must not depend on PinStateTree.

This keeps Summary/Pin usable even if the tree abstraction later changes.

## Formal model

A tree:

```ts
interface PinStateTree {
  id: string;
  root: NodeId;
  activeLeaf: NodeId;
  nodes: Record<NodeId, PinStateNode>;
}

interface PinStateNode {
  id: string;
  parent?: NodeId;
  label: string;
  pins: PinIntent[];
  metadata?: Record<string, unknown>;
}
```

Invariant: exactly one active node/leaf per tree. Multiple independent trees may be active simultaneously.

Derived pin set:

```text
ActivePins(tree) = union(pins(node) for node in root→activeLeaf path)
EffectivePins = merge(ActivePins(tree_1), ..., ActivePins(tree_n), manual pins)
```

The tree stores pin **intents**, not duplicated model messages.

## March vs jump

- `march(child)` — transition to a child of current active node; useful for workflows/steps.
- `jump(node)` — select any valid node; useful for profiles/modes or recovery.

Both operations should be atomic from the model's perspective: update controller state, recompute derived pins, and report the new effective path/pins before the next model request.

## Display model

The original proposal's compact view is sensible:

- show current root→leaf path;
- at each depth show siblings around the selected path node;
- do not dump every descendant unless explicitly requested.

This gives the model actionable transition options without consuming context on the full graph.

## Conflict semantics

Multiple trees can pin overlapping or contradictory instructions. The controller cannot hide this problem.

Recommended v1 rule:

- deduplicate identical source/snapshot pins by stable pin identity/content hash;
- do not automatically resolve contradictory instruction text;
- inspection should show provenance: manual vs tree ID + node ID;
- later, optional tree priority can define ordering, but never silently delete a conflicting instruction.

## Persistence scope

Suggested initial scope: project/session plugin state, with active leaf persisted as a custom session state entry when the tree is session-driven.

A reusable workflow/profile tree may be stored as a project resource, while each session keeps only its active leaf selection. Keep **definition persistence** and **runtime selection persistence** separate.

## Why it should be deferred

Before PinStateTree implementation, we need E3/E4 evidence for:

- stable pin addresses;
- branch/resume semantics;
- tail/system placement behavior;
- compaction survival;
- conflict introspection;
- model ability to use plain pin/unpin sensibly.

Otherwise a tree will multiply unclear semantics and make failures hard to attribute.

## First useful experiment after Pin v1

Build a userland prototype with no core changes:

- one “workflow” tree with 3–5 steps;
- node instructions become tail instruction pins;
- one independent “profile” tree toggles a coding/review behavior pin;
- allow agent `march`, `jump`, `inspect`;
- compare against explicit manual pin/unpin on a repeated multi-stage task.

Promote the abstraction only if it measurably reduces missed phase constraints or context-management overhead.
