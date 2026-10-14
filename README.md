# actor-typed-dsl

An executable reference DSL for actor session protocols inspired by **Maty** in Fowler & Hu, [*Speak Now: Safe Actor Programming with Multiparty Session Types*](https://arxiv.org/html/2602.24054v2).

The authoring API replaces algebraic symbols with canonical function constructors and supports readable, multiline nested definitions. A versioned **2flow** contract defines the ordered transformations from canonical session trees to a JSON runtime contract, and a Zig executor interprets that contract.

## Current scope

- Canonical constructors: `end()`, `branch(payload, next)`, `select(peer, branches)`, `offer(peer, branches)`, `mu(name, body)`, and `ref(name)`.
- Protocol validation for role references, recursion binding/guarding, and supported two-role duality obligations.
- Flow-sensitive send checking in TypeScript.
- A deterministic 2flow lowering pipeline: **parse → validate → normalize → lower → execute**.
- A versioned JSON contract shared with the Zig runtime.
- A Zig executor that processes ordered send/receive events, checks current state, peer, direction, label and payload type, advances to the continuation, and rejects invalid traces.
- TypeScript regression tests and Zig positive/negative integration tests in GitHub Actions.

This is an executable reference subset, not a complete verified implementation of Maty. The full term calculus and typing judgements, arbitrary multiparty compliance, operational semantics, preservation/progress proofs, and supervision/failure semantics are not implemented. The runtime does not claim a global progress proof.

## Install and test

TypeScript requires Node.js 22+. The Zig runtime and integration tests use Zig 0.13.0.

```sh
npm install
npm test

cd zig-executor
zig build
sh test.sh
```

CI runs both suites.

## Canonical multiline DSL

The following constructors use normal function names rather than the paper's algebraic symbols. See [the DSL guide](docs/canonical-dsl.md) and [a complete example](examples/canonical-client-server.ts).

```ts
const client = select("Server", {
  Get: branch(
    "Unit",
    select("Server", {
      Quit: branch("Unit", end),
    }),
  ),
});

const server = offer("Client", {
  Get: branch(
    "Unit",
    offer("Client", {
      Quit: branch("Unit", end),
    }),
  ),
});

const result = validateProtocol({ Client: client, Server: server });
if (!result.ok) {
  throw new Error(JSON.stringify(result.diagnostics, null, 2));
}
```

## 2flow: canonical AST to Zig runtime

The pipeline contract lives at [`2flow/session-pipeline.2flow.json`](2flow/session-pipeline.2flow.json). The TypeScript implementation is `src/twoflow.ts`; its `lowerProtocolToRuntime(protocol, role, events)` returns the versioned JSON-compatible document after successful validation. Serialize that document as JSON and pass it to `zig-executor/zig-out/bin/maty-exec`.

```ts
import { lowerProtocolToRuntime } from "./src/twoflow.js";

const lowered = lowerProtocolToRuntime(protocol, "Client", [
  { action: "send", peer: "Server", label: "Get", payload: "Unit" },
]);

if (!lowered.ok) {
  throw new Error(JSON.stringify(lowered.diagnostics, null, 2));
}

const runtimeJson = JSON.stringify(lowered.document, null, 2);
```

The Zig executor consumes the runtime document shape demonstrated in [`zig-executor/examples/ping-pong.json`](zig-executor/examples/ping-pong.json). Actions are checked against the local state: `send` requires `select`, `receive` requires `offer`. Every successful event advances exactly once. Invalid actions, peers, labels, payloads, unbound recursion, and traces continuing after `end` fail closed.

## Formal correspondence

| Paper concept | Canonical function |
| --- | --- |
| Output/selection session type (`⊕`) | `select(peer, branches)` |
| Input/branching session type (`&`) | `offer(peer, branches)` |
| Recursive type (`μ X.S`) | `mu("X", body)` |
| Recursion variable (`X`) | `ref("X")` |
| Term send / T-Send | `send(session, peer, label, payloadType)` |
| Protocol mapping | `validateProtocol({ Role: localSession })` |

The JSON runtime format uses named node kinds (`select`, `offer`, `mu`, `ref`, `end`) and never uses algebraic symbols as executable syntax.

## Reference

Simon Fowler and Raymond Hu. [Speak Now: Safe Actor Programming with Multiparty Session Types (Extended Version)](https://arxiv.org/html/2602.24054v2), especially §3.1–3.2 for syntax and typing rules and §4 for metatheory. Licensed CC BY 4.0 on arXiv.
