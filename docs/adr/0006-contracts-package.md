# 0006 · Contracts package and one order spec

Status: Proposed · Date: 2026-11-07

## Context

File and line references in this section are to v1.0 (`b898c0a`). Later commits of this series move or remove some of those files.

A kind of order is declared three times today:

- as a member of the `Order` union in `packages/engine/src/game.ts:22`;
- as an entry of `ORDER_KINDS` in `packages/protocol/src/orders.ts:18`, whose position is the code in binary frames;
- as a zod object in `packages/protocol/src/orders.ts:42`.

There are 17 kinds. Adding one means three edits that nothing forces to agree, and the zod schema and the engine union can drift apart silently. The protocol cannot import the engine, because the protocol is shared with the server, which never simulates ([ADR 0001](0001-deterministic-lockstep.md)). Constants both sides need, such as `TICK_RATE` (`packages/protocol/src/messages.ts:21`) and the `Disable` and rules bits (`packages/engine/src/game.ts:132-156`), live on whichever side defined them first, and the other side copies or re-exports them.

## Decision

Add a package, `@frontfall/contracts`, with no dependency and no runtime behaviour beyond constants and one table.

- It holds the hand-written `Order` union, with its doc comments kept, and an `ORDER_SPEC` table that `satisfies` it. A type-level test checks both ways: every union member has a spec entry, and every entry names a union member.
- `ORDER_SPEC` lists each kind once, in wire order, with its fields and their bounds. The protocol derives its zod schema and its binary codec from it. The engine takes the type.
- It also holds the constants both sides need: tick rate, the `Disable` and rules bits, the operator bonus, team counts, difficulties and the kind counts.
- Wire bytes and `PROTOCOL_VERSION` (29, `packages/protocol/src/messages.ts:18`) do not change. The existing frame tests (`packages/protocol/test/binary.test.ts:179-205`) are the proof, and the kinds they do not yet pin get a pin first.
- The engine may import contracts and nothing else. The protocol may import zod and contracts.

## Consequences

- A new order is declared once, in the contracts, plus its rule in the engine ([ADR 0007](0007-order-dispatch.md)). A missing or extra entry fails type checking.
- The engine gains its first dependency, an internal one. The "engine has no dependency" boundary test becomes "engine depends on contracts only" ([ADR 0014](0014-enforced-boundaries.md)), and the build that compiles the simulation for the worker and the ESLint determinism glob must include the new package.
- A fifth package to version, build and document.
- The spec is data read at startup by the protocol, so a mistake in it shows at startup or in tests, not at the type level alone. The pinned frames catch it.

## Alternatives considered

- **Derive the union from the zod schema.** This puts zod, a runtime library, under the engine's types, and loses the doc comments on each order. Rejected.
- **Generate the code from a spec file.** A build step and generated files in review, for 17 kinds. Rejected.
- **Move the union into the protocol and let the engine import it.** The engine would depend on a package that depends on zod, and `docs/engine.md` promises no dependency. Rejected.
- **Keep three declarations and add a test that compares them.** Catches drift but not the work of three edits. A comparison test remains as the two-way `satisfies` check.

## Deferred

- Moving the schemas of the non-order messages (lobby, accounts) into contracts. They are not shared with the engine.
