# actor-typed-dsl

An executable TypeScript DSL for describing and checking actor session protocols, inspired by the formal core language **Maty** in Fowler & Hu, *Speak Now: Safe Actor Programming with Multiparty Session Types* (arXiv:2602.24054v2).

The paper's key idea is flow-sensitive session effects: a communication action is legal only when the current local session type permits it. Maty uses local selection types (`⊕`), branching types (`&`), recursion, and `end`; message reception is represented by installing a handler and suspending rather than an explicit receive operation.

## Status and scope

This repository implements an **executable reference subset**, not a complete verified implementation of Maty's calculus. It currently provides:
- DSL constructors for local `select` / `offer` session types, message payloads, recursion (`mu` / `ref`) and `end`.
- Static protocol validation for role references and recursion binding/guarding.
- Direct two-role duality checks for message labels, directions and payload types.
- A flow-sensitive `send` checker that rejects invalid peers, labels, directions and payload types and advances to the branch continuation.
- Automated regression tests and GitHub Actions CI.

The paper's full term calculus and typing judgements (`Γ ⊢ V : A` and `Γ | C | S ▷ M : A ◁ T`), global compliance predicate for arbitrary multiparty interleavings, operational semantics, preservation/progress proofs, and supervision/failure semantics are **not yet implemented**. The current duality checker is intentionally conservative and should not be treated as a proof of global progress for arbitrary multi-party protocols.

## Install and test

Requires Node.js 22+.

```sh
npm install
npm test
```

## Example

```ts
import { branch, end, offer, select, send, validateProtocol } from "@suissa/actor-typed-dsl";

const client = select("Server", {
  Get: branch("Unit", select("Server", { Quit: branch("Unit", end) }))
});

const server = offer("Client", {
  Get: branch("Unit", offer("Client", { Quit: branch("Unit", end) }))
});

const protocol = validateProtocol({ Client: client, Server: server });
if (!protocol.ok) throw new Error(JSON.stringify(protocol.diagnostics));

const firstStep = send(client, "Server", "Get", "Unit");
if (!firstStep.ok) throw new Error(firstStep.diagnostic?.message ?? "Send failed");
// firstStep.next is now the session type after Get.
```

## Formal correspondence

| Paper concept | DSL representation |
| --- | --- |
| Output/selection session type `p ⊕ { lᵢ(Aᵢ).Sᵢ }` | `select(peer, { label: branch(payload, continuation) })` |
| Input/branching session type `p & { lᵢ(Aᵢ).Sᵢ }` | `offer(peer, { label: branch(payload, continuation) })` |
| Recursive type `μ X.S` | `mu("X", S)` |
| Recursion variable `X` | `ref("X")` |
| Term send `p ! l(V)` / T-Send | `send(session, peer, label, payloadType)` |
| Protocol `P = { pᵢ : Sᵢ }` | `validateProtocol({ Role: localSession, ... })` |

This maps the DSL to the paper's **local session-type syntax and send typing rule**, not to the full proof metatheory.

## Reference

Simon Fowler and Raymond Hu. [Speak Now: Safe Actor Programming with Multiparty Session Types (Extended Version)](https://arxiv.org/html/2602.24054v2), especially §3.1–3.2 for syntax and typing rules and §4 for metatheory. Licensed CC BY 4.0 on arXiv.
