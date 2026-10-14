# Canonical Maty DSL

This project uses ordinary named functions instead of the algebraic symbols in the paper. Each constructor is written on its own line and nested continuations are indented. The AST remains the source of truth; this is not a one-line string notation.

## Canonical constructors

- `end()`: terminate the session.
- `branch(payload, next)`: declare the payload type and continuation for one message label.
- `select(peer, { ... })`: this role chooses a message to send to `peer` (the paper's `⊕`).
- `offer(peer, { ... })`: this role accepts one of the messages from `peer` (the paper's `&`).
- `mu(name, body)`: bind a recursive session (the paper's `μ`).
- `ref(name)`: refer to a recursive binding.
- `validateProtocol(protocol)`: validate role references, recursion, and supported duality obligations.
- `send(state, peer, label, payload)`: check a send against the current state and return the next state.

## Example

```ts
import {
  branch,
  end,
  offer,
  select,
  validateProtocol,
} from "../src/session.js";

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

const protocol = {
  Client: client,
  Server: server,
};

const validation = validateProtocol(protocol);
if (!validation.ok) {
  throw new Error(JSON.stringify(validation.diagnostics, null, 2));
}
```

## 2flow transformation order

The pipeline is explicitly ordered and versioned in `2flow/session-pipeline.2flow.json`. Its stages are:

1. **parse** the canonical function-built session tree into the runtime document model;
2. **validate** protocol roles, branch definitions, payload names, and recursion;
3. **normalize** object key order and node representation for reproducible output;
4. **lower** the normalized model to the versioned JSON runtime contract;
5. **execute** the lowered contract with the Zig runtime.

A stage must fail closed: a failed validation cannot be lowered or executed. The JSON document is the boundary between the TypeScript authoring DSL and Zig, not a second hand-maintained protocol definition.

## Scope

The runtime format preserves the named constructors as node kinds (`end`, `select`, `offer`, `mu`, `ref`) and does not emit `⊕`, `&`, or `μ`. This implementation checks and executes local session transitions. It does not claim to implement the paper's full global multiparty compliance proof or Maty's complete actor calculus.
