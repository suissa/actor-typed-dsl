/**
 * Executable core of a session-type DSL inspired by Maty:
 * local selection/branching types, recursion, protocol validation and
 * flow-sensitive send checking. This is a reference checker, not a proof
 * assistant or a complete implementation of every term-typing rule in the paper.
 */
export type PayloadType = "Unit" | "Bool" | "Int" | "String" | "Float" | "Bytes";

export interface Branch {
  readonly payload: PayloadType;
  readonly next: Session;
}

export type Session =
  | { readonly kind: "end" }
  | { readonly kind: "select"; readonly peer: string; readonly branches: Readonly<Record<string, Branch>> }
  | { readonly kind: "offer"; readonly peer: string; readonly branches: Readonly<Record<string, Branch>> }
  | { readonly kind: "mu"; readonly variable: string; readonly body: Session }
  | { readonly kind: "var"; readonly variable: string };

export type Protocol = Readonly<Record<string, Session>>;

export interface Diagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly diagnostics: readonly [] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export const end: Session = Object.freeze({ kind: "end" });

function branches(input: Record<string, Branch>): Readonly<Record<string, Branch>> {
  if (Object.keys(input).length === 0) throw new TypeError("A choice must contain at least one branch");
  for (const [label, branch] of Object.entries(input)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) throw new TypeError(`Invalid message label: ${label}`);
    if (!branch || !["Unit", "Bool", "Int", "String", "Float", "Bytes"].includes(branch.payload)) {
      throw new TypeError(`Invalid payload type for label ${label}`);
    }
  }
  return Object.freeze({ ...input });
}

export function select(peer: string, choices: Record<string, Branch>): Session {
  assertName(peer, "peer");
  return Object.freeze({ kind: "select", peer, branches: branches(choices) });
}

export function offer(peer: string, choices: Record<string, Branch>): Session {
  assertName(peer, "peer");
  return Object.freeze({ kind: "offer", peer, branches: branches(choices) });
}

export function branch(payload: PayloadType, next: Session = end): Branch {
  return Object.freeze({ payload, next });
}

export function mu(variable: string, body: Session): Session {
  assertName(variable, "recursion variable");
  return Object.freeze({ kind: "mu", variable, body });
}

export function ref(variable: string): Session {
  assertName(variable, "recursion variable");
  return Object.freeze({ kind: "var", variable });
}

function assertName(value: string, kind: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError(`Invalid ${kind}: ${value}`);
}

function collectDiagnostics(protocol: Protocol): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const roles = new Set(Object.keys(protocol));
  if (roles.size < 2) diagnostics.push({ code: "PROTOCOL_ROLE_COUNT", path: "$", message: "A session protocol must define at least two roles." });

  for (const [role, root] of Object.entries(protocol)) {
    const visit = (node: Session, path: string, scope: Set<string>, guarded: Set<string>): void => {
      switch (node.kind) {
        case "end": return;
        case "var":
          if (!scope.has(node.variable)) diagnostics.push({ code: "UNBOUND_RECURSION", path, message: `Unbound recursion variable '${node.variable}'.` });
          else if (!guarded.has(node.variable)) diagnostics.push({ code: "UNGUARDED_RECURSION", path, message: `Recursion variable '${node.variable}' is not guarded by a communication action.` });
          return;
        case "mu": {
          if (scope.has(node.variable)) diagnostics.push({ code: "DUPLICATE_RECURSION_BINDER", path, message: `Recursion variable '${node.variable}' shadows an active binder.` });
          const nextScope = new Set(scope); nextScope.add(node.variable);
          const nextGuarded = new Set(guarded); nextGuarded.delete(node.variable);
          visit(node.body, path + ".body", nextScope, nextGuarded);
          return;
        }
        case "select":
        case "offer": {
          if (!roles.has(node.peer)) diagnostics.push({ code: "UNKNOWN_PEER", path, message: `Role '${role}' refers to unknown peer '${node.peer}'.` });
          for (const [label, item] of Object.entries(node.branches)) {
            const nextGuarded = new Set(guarded);
            for (const name of scope) nextGuarded.add(name);
            visit(item.next, `${path}.branches.${label}`, scope, nextGuarded);
          }
        }
      }
    };
    visit(root, `protocol.${role}`, new Set(), new Set());
  }
  return diagnostics;
}

/**
 * Validate role references and recursion, then check duality for direct
 * two-role interactions. For multi-party protocols this is a conservative
 * local checker; it does not claim to implement the paper's full compliance
 * predicate for arbitrary interleavings.
 */
export function validateProtocol(protocol: Protocol): ValidationResult {
  const diagnostics = collectDiagnostics(protocol);
  if (diagnostics.length === 0) {
    const seen = new Set<string>();
    for (const role of Object.keys(protocol)) {
      for (const peer of Object.keys(protocol)) {
        if (role === peer) continue;
        const key = [role, peer].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        checkDuality(protocol[role]!, protocol[peer]!, role, peer, diagnostics, new Set());
      }
    }
  }
  return diagnostics.length
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics: [] };
}

function unfold(session: Session, env: Map<string, Session> = new Map()): Session {
  let current = session;
  const local = new Map(env);
  while (current.kind === "mu") {
    local.set(current.variable, current);
    current = current.body;
  }
  if (current.kind === "var") {
    const binder = local.get(current.variable);
    if (binder?.kind === "mu") return unfold(binder.body, local);
  }
  return current;
}

function checkDuality(
  left: Session, right: Session, leftRole: string, rightRole: string,
  diagnostics: Diagnostic[], seen: Set<string>, leftEnv = new Map<string, Session>(), rightEnv = new Map<string, Session>()
): void {
  const a = unfold(left, leftEnv);
  const b = unfold(right, rightEnv);
  if (a.kind === "end" || b.kind === "end") {
    if (a.kind !== b.kind) diagnostics.push({ code: "DUALITY_MISMATCH", path: `protocol.${leftRole}/${rightRole}`, message: "One role reaches end while the other still expects communication." });
    return;
  }
  if (a.kind === "var" || b.kind === "var") return;
  const pairKey = JSON.stringify([a, b]);
  if (seen.has(pairKey)) return;
  seen.add(pairKey);

  // A duality obligation exists when these two roles communicate directly.
  if (a.peer === rightRole || b.peer === leftRole) {
    if (a.peer !== rightRole || b.peer !== leftRole || a.kind === b.kind) {
      diagnostics.push({ code: "DUALITY_MISMATCH", path: `protocol.${leftRole}/${rightRole}`, message: "Communication direction or peer does not match the dual local type." });
      return;
    }
    const labelsA = Object.keys(a.branches).sort();
    const labelsB = Object.keys(b.branches).sort();
    if (JSON.stringify(labelsA) !== JSON.stringify(labelsB)) {
      diagnostics.push({ code: "DUALITY_LABELS", path: `protocol.${leftRole}/${rightRole}`, message: `Choice labels differ: ${labelsA.join(", ")} versus ${labelsB.join(", ")}.` });
      return;
    }
    for (const label of labelsA) {
      const ba = a.branches[label]!, bb = b.branches[label]!;
      if (ba.payload !== bb.payload) {
        diagnostics.push({ code: "DUALITY_PAYLOAD", path: `protocol.${leftRole}/${rightRole}.${label}`, message: `Payload mismatch: ${ba.payload} versus ${bb.payload}.` });
      } else {
        checkDuality(ba.next, bb.next, leftRole, rightRole, diagnostics, seen, leftEnv, rightEnv);
      }
    }
  }
}

/** A flow-sensitive session cursor: each valid send advances to its continuation. */
export interface SendResult {
  readonly ok: boolean;
  readonly next?: Session;
  readonly diagnostic?: Diagnostic;
}

export function send(current: Session, peer: string, label: string, payload: PayloadType): SendResult {
  const state = unfold(current);
  if (state.kind !== "select") {
    return { ok: false, diagnostic: { code: "SEND_NOT_ALLOWED", path: "$", message: `Cannot send while session state is '${state.kind}'; a selection state is required.` } };
  }
  if (state.peer !== peer) {
    return { ok: false, diagnostic: { code: "WRONG_PEER", path: "$", message: `Expected peer '${state.peer}', got '${peer}'.` } };
  }
  const selected = state.branches[label];
  if (!selected) {
    return { ok: false, diagnostic: { code: "UNKNOWN_LABEL", path: "$", message: `Message '${label}' is not allowed; expected one of: ${Object.keys(state.branches).join(", ")}.` } };
  }
  if (selected.payload !== payload) {
    return { ok: false, diagnostic: { code: "PAYLOAD_TYPE_MISMATCH", path: `$.${label}`, message: `Message '${label}' requires payload ${selected.payload}, got ${payload}.` } };
  }
  return { ok: true, next: selected.next };
}

export function formatSession(session: Session): string {
  switch (session.kind) {
    case "end": return "end";
    case "var": return session.variable;
    case "mu": return `mu ${session.variable}. ${formatSession(session.body)}`;
    case "select":
    case "offer": {
      const operator = session.kind === "select" ? "⊕" : "&";
      const choices = Object.entries(session.branches)
        .map(([label, item]) => `${label}(${item.payload}).${formatSession(item.next)}`)
        .join(", ");
      return `${session.peer} ${operator} {${choices}}`;
    }
  }
}
