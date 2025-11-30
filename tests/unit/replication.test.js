import { strict as assert } from "assert";
import { getPendingLogsFromSource } from "../../src/services/recoveryService.js";

// Mock pool
const mockPool = {
  query: async (sql, params) => {
    return [[], []]; // return empty rows
  },
};

const mockSource = {
  name: "node1",
  pool: mockPool,
};

async function testReplicationLogic() {
  console.log("Testing Replication Logic...");

  let capturedSql = "";
  mockPool.query = async (sql, params) => {
    capturedSql = sql;
    return [[], []];
  };

  // Test 1: Node 1 -> Node 2 (Should have JNT filter)
  await getPendingLogsFromSource(mockSource, "node2");
  assert.ok(capturedSql.includes("courierName')) = 'JNT'"), "Node 2 SQL should filter for JNT");
  assert.ok(!capturedSql.includes("!= 'JNT'"), "Node 2 SQL should NOT have != JNT");
  console.log("PASS: Node 1 -> Node 2 filtering");

  // Test 2: Node 1 -> Node 3 (Should have != JNT filter)
  await getPendingLogsFromSource(mockSource, "node3");
  assert.ok(capturedSql.includes("courierName')) != 'JNT'"), "Node 3 SQL should filter for != JNT");
  console.log("PASS: Node 1 -> Node 3 filtering");

  // Test 3: Node 2 -> Node 1 (No filter)
  const mockNode2 = { name: "node2", pool: mockPool };
  await getPendingLogsFromSource(mockNode2, "node1");
  assert.ok(!capturedSql.includes("courierName"), "Node 2 -> Node 1 should NOT have courier filters");
  console.log("PASS: Node 2 -> Node 1 no filtering");

  console.log("All unit tests passed!");
}

testReplicationLogic().catch(err => {
  console.error("FAILED:", err);
  process.exit(1);
});
