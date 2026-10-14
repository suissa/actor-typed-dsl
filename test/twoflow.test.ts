import test from "node:test";
import assert from "node:assert/strict";
import { branch, end, offer, select } from "../src/session.js";
import { lowerProtocolToRuntime, MATY_2FLOW_STAGES } from "../src/twoflow.js";

test("2flow lowers canonical constructors to stable JSON node kinds", () => {
  const result = lowerProtocolToRuntime({
    Client: select("Server", { Zed: branch("Unit"), Alpha: branch("String", end) }),
    Server: offer("Client", { Alpha: branch("String", end), Zed: branch("Unit") }),
  }, "Client", [{ action: "send", peer: "Server", label: "Alpha", payload: "String" }]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.stages, MATY_2FLOW_STAGES);
  assert.deepEqual(Object.keys(result.document.protocol), ["Client", "Server"]);
  const client = result.document.protocol.Client;
  assert.equal(client.kind, "select");
  if (client.kind !== "select") return;
  assert.deepEqual(Object.keys(client.branches), ["Alpha", "Zed"]);
  assert.equal(client.branches.Alpha?.next.kind, "end");
  assert.equal(result.document.events.length, 1);
  assert.equal(JSON.stringify(result.document).includes("⊕"), false);
  assert.equal(JSON.stringify(result.document).includes("μ"), false);
});

test("2flow stops before lowering when protocol validation fails", () => {
  const result = lowerProtocolToRuntime({
    Client: select("Server", { Send: branch("Int") }),
    Server: offer("Client", { Send: branch("String") }),
  }, "Client", []);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, "validate");
  assert.ok(result.diagnostics.some(item => item.code === "DUALITY_PAYLOAD"));
});

test("2flow rejects an execution role absent from the protocol", () => {
  const result = lowerProtocolToRuntime({
    Client: select("Server", { Send: branch("Unit") }),
    Server: offer("Client", { Send: branch("Unit") }),
  }, "Missing", []);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.diagnostics.some(item => item.code === "UNKNOWN_EXECUTION_ROLE"));
});
