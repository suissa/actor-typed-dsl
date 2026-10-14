import test from "node:test";
import assert from "node:assert/strict";
import { branch, end, formatSession, mu, offer, ref, select, send, validateProtocol } from "../src/session.js";

test("accepts dual two-party protocol", () => {
  const client = select("Server", {
    Get: branch("Unit", select("Server", { Quit: branch("Unit") }))
  });
  const server = offer("Client", {
    Get: branch("Unit", offer("Client", { Quit: branch("Unit") }))
  });
  assert.equal(validateProtocol({ Client: client, Server: server }).ok, true);
});

test("rejects mismatched message labels", () => {
  const result = validateProtocol({
    Client: select("Server", { Get: branch("Unit") }),
    Server: offer("Client", { Put: branch("Unit") })
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(d => d.code === "DUALITY_LABELS"));
});

test("rejects mismatched payloads", () => {
  const result = validateProtocol({
    Client: select("Server", { Count: branch("Int") }),
    Server: offer("Client", { Count: branch("String") })
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(d => d.code === "DUALITY_PAYLOAD"));
});

test("send advances the session and enforces peer, label and payload", () => {
  const session = select("Server", { Get: branch("Unit", select("Server", { Done: branch("Bool") })) });
  const sent = send(session, "Server", "Get", "Unit");
  assert.equal(sent.ok, true);
  assert.equal(sent.next?.kind, "select");
  assert.equal(send(session, "Other", "Get", "Unit").diagnostic?.code, "WRONG_PEER");
  assert.equal(send(session, "Server", "Missing", "Unit").diagnostic?.code, "UNKNOWN_LABEL");
  assert.equal(send(session, "Server", "Get", "Int").diagnostic?.code, "PAYLOAD_TYPE_MISMATCH");
});

test("rejects unknown roles and unbound recursion variables", () => {
  const result = validateProtocol({ A: select("Missing", { Go: branch("Unit", ref("X")) }), B: end });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(d => d.code === "UNKNOWN_PEER"));
  assert.ok(result.diagnostics.some(d => d.code === "UNBOUND_RECURSION"));
});

test("supports guarded recursive session syntax", () => {
  const loop = mu("X", select("Server", { Ping: branch("Unit", ref("X")) }));
  assert.equal(formatSession(loop), "mu X. Server ⊕ {Ping(Unit).X}");
  assert.equal(validateProtocol({
    Client: loop,
    Server: mu("Y", offer("Client", { Ping: branch("Unit", ref("Y")) }))
  }).ok, true);
});

test("rejects unguarded recursion", () => {
  const result = validateProtocol({
    A: mu("X", ref("X")),
    B: end
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(d => d.code === "UNGUARDED_RECURSION"));
});
