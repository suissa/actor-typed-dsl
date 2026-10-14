const std = @import("std");

const Value = std.json.Value;
const Allocator = std.mem.Allocator;
const max_input_bytes = 16 * 1024 * 1024;

fn field(value: Value, name: []const u8) ?Value {
    if (value != .object) return null;
    return value.object.get(name);
}

fn stringValue(value: Value) ?[]const u8 {
    return if (value == .string) value.string else null;
}

fn stringField(value: Value, name: []const u8) ?[]const u8 {
    const found = field(value, name) orelse return null;
    return stringValue(found);
}

fn fail(message: []const u8) noreturn {
    std.debug.print("maty-exec: {s}\n", .{message});
    std.process.exit(1);
}

fn requireString(value: Value, name: []const u8) []const u8 {
    return stringField(value, name) orelse fail(name);
}

fn resolveNode(node_input: Value, env: *std.StringHashMap(Value), fuel: *usize) Value {
    var node = node_input;
    while (true) {
        if (fuel.* == 0) fail("recursive expansion limit exceeded (possible unguarded recursion)");
        fuel.* -= 1;

        const kind = stringField(node, "kind") orelse fail("session node is missing string field 'kind'");
        if (std.mem.eql(u8, kind, "mu")) {
            const variable = requireString(node, "variable");
            const body = field(node, "body") orelse fail("mu node is missing 'body'");
            env.put(variable, body) catch fail("out of memory while binding recursion variable");
            node = body;
            continue;
        }
        if (std.mem.eql(u8, kind, "ref")) {
            const variable = requireString(node, "variable");
            node = env.get(variable) orelse fail("unbound recursion variable at runtime");
            continue;
        }
        if (std.mem.eql(u8, kind, "end") or std.mem.eql(u8, kind, "select") or std.mem.eql(u8, kind, "offer")) {
            return node;
        }
        fail("unknown session node kind");
    }
}

fn execute(allocator: Allocator, document: Value) !void {
    const protocol = field(document, "protocol") orelse fail("document is missing 'protocol'");
    if (protocol != .object) fail("'protocol' must be an object");
    const role = requireString(document, "role");
    const events_value = field(document, "events") orelse fail("document is missing 'events'");
    if (events_value != .array) fail("'events' must be an array");
    var cursor = protocol.object.get(role) orelse fail("role is not defined in protocol");

    var env = std.StringHashMap(Value).init(allocator);
    defer env.deinit();

    for (events_value.array.items, 0..) |event, index| {
        var fuel: usize = 10000;
        cursor = resolveNode(cursor, &env, &fuel);
        const kind = requireString(cursor, "kind");
        if (std.mem.eql(u8, kind, "end")) fail("event received after session reached end");
        const action = requireString(event, "action");
        const peer = requireString(event, "peer");
        const label = requireString(event, "label");
        const payload = requireString(event, "payload");
        const expected_action: []const u8 = if (std.mem.eql(u8, kind, "select")) "send" else "receive";

        if (!std.mem.eql(u8, action, expected_action)) {
            std.debug.print("event {d}: action '{s}' is invalid for node '{s}' (expected '{s}')\n", .{ index, action, kind, expected_action });
            fail("invalid action direction");
        }
        const expected_peer = requireString(cursor, "peer");
        if (!std.mem.eql(u8, peer, expected_peer)) fail("event peer does not match current session state");

        const branches_value = field(cursor, "branches") orelse fail("session node is missing 'branches'");
        if (branches_value != .object) fail("'branches' must be an object");
        const branch_value = branches_value.object.get(label) orelse fail("event label is not allowed by current session state");
        const expected_payload = requireString(branch_value, "payload");
        if (!std.mem.eql(u8, payload, expected_payload)) fail("event payload type does not match branch contract");

        cursor = field(branch_value, "next") orelse .{ .object = std.json.ObjectMap.init(allocator) };
        if (field(branch_value, "next") == null) {
            // An omitted continuation is the canonical shorthand for end().
            var end_node = std.json.ObjectMap.init(allocator);
            try end_node.put("kind", .{ .string = "end" });
            cursor = .{ .object = end_node };
        }
    }

    var fuel: usize = 10000;
    cursor = resolveNode(cursor, &env, &fuel);
    const final_kind = requireString(cursor, "kind");
    const stdout = std.io.getStdOut().writer();
    try stdout.print("{{\"ok\":true,\"role\":\"{s}\",\"events_executed\":{d},\"state\":\"{s}\"}}\n", .{
        role,
        events_value.array.items.len,
        final_kind,
    });
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);
    if (args.len != 2) fail("usage: maty-exec <runtime-document.json>");

    const bytes = try std.fs.cwd().readFileAlloc(allocator, args[1], max_input_bytes);
    defer allocator.free(bytes);

    const parsed = std.json.parseFromSlice(Value, allocator, bytes, .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = false,
    }) catch fail("input is not valid JSON");
    defer parsed.deinit();

    try execute(allocator, parsed.value);
}
