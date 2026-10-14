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

const result = validateProtocol(protocol);

if (!result.ok) {
  throw new Error(JSON.stringify(result.diagnostics, null, 2));
}

console.log("Canonical Maty protocol is valid.");
