import {
  type PayloadType,
  type Protocol,
  type Session,
  type ValidationResult,
  validateProtocol,
} from "./session.js";

export const MATY_2FLOW_STAGES = ["parse", "validate", "normalize", "lower", "execute"] as const;

export interface RuntimeEvent {
  readonly action: "send" | "receive";
  readonly peer: string;
  readonly label: string;
  readonly payload: PayloadType;
}
export interface RuntimeDocument {
  readonly contract: "actor-typed-dsl.session-runtime";
  readonly contractVersion: "1.0.0";
  readonly protocol: Readonly<Record<string, RuntimeSession>>;
  readonly role: string;
  readonly events: readonly RuntimeEvent[];
}
export type RuntimeSession =
  | { readonly kind: "end" }
  | { readonly kind: "select" | "offer"; readonly peer: string; readonly branches: Readonly<Record<string, RuntimeBranch>> }
  | { readonly kind: "mu"; readonly variable: string; readonly body: RuntimeSession }
  | { readonly kind: "ref"; readonly variable: string };
export interface RuntimeBranch { readonly payload: PayloadType; readonly next: RuntimeSession; }
export interface PipelineResult { readonly ok: true; readonly stages: typeof MATY_2FLOW_STAGES; readonly document: RuntimeDocument; }
export interface PipelineFailure {
  readonly ok: false;
  readonly stage: "parse" | "validate";
  readonly diagnostics: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

function parseCanonicalTree(protocol: Protocol): Protocol {
  if (!protocol || typeof protocol !== "object" || Array.isArray(protocol)) {
    throw new TypeError("Protocol must be a role-to-session object.");
  }
  if (Object.keys(protocol).length < 2) {
    throw new TypeError("Protocol must declare at least two roles.");
  }
  return protocol;
}

function normalizeSession(session: Session): RuntimeSession {
  switch (session.kind) {
    case "end": return { kind: "end" };
    case "var": return { kind: "ref", variable: session.variable };
    case "mu": return { kind: "mu", variable: session.variable, body: normalizeSession(session.body) };
    case "select":
    case "offer": {
      const normalized: Record<string, RuntimeBranch> = {};
      for (const label of Object.keys(session.branches).sort()) {
        const item = session.branches[label]!;
        normalized[label] = { payload: item.payload, next: normalizeSession(item.next) };
      }
      return { kind: session.kind, peer: session.peer, branches: normalized };
    }
  }
}

/** Runs parse, validate, normalize and lower; Zig provides the final execute stage. */
export function lowerProtocolToRuntime(
  input: Protocol,
  role: string,
  events: readonly RuntimeEvent[],
): PipelineResult | PipelineFailure {
  let parsed: Protocol;
  try {
    parsed = parseCanonicalTree(input);
  } catch (error) {
    return {
      ok: false,
      stage: "parse",
      diagnostics: [{
        code: "CANONICAL_PARSE",
        path: "$",
        message: error instanceof Error ? error.message : "Invalid canonical protocol.",
      }],
    };
  }

  const validation: ValidationResult = validateProtocol(parsed);
  if (!validation.ok) {
    return { ok: false, stage: "validate", diagnostics: validation.diagnostics };
  }
  if (!Object.hasOwn(parsed, role)) {
    return {
      ok: false,
      stage: "validate",
      diagnostics: [{
        code: "UNKNOWN_EXECUTION_ROLE",
        path: "$.role",
        message: "Role '" + role + "' is not defined in the protocol.",
      }],
    };
  }

  const normalized: Record<string, RuntimeSession> = {};
  for (const name of Object.keys(parsed).sort()) {
    normalized[name] = normalizeSession(parsed[name]!);
  }

  return {
    ok: true,
    stages: MATY_2FLOW_STAGES,
    document: {
      contract: "actor-typed-dsl.session-runtime",
      contractVersion: "1.0.0",
      protocol: normalized,
      role,
      events: [...events],
    },
  };
}
