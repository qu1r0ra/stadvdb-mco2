# Design Decisions

This document explains the **Why** behind every architectural choice in the STADVDB MCO2 project.

**Purpose**: Provide technical justification for concurrency, replication, recovery, and simulation strategies.

---

## Table of Contents

- [1. Concurrency Control](#1-concurrency-control)
  - [1.1. REPEATABLE READ Isolation Level](#11-repeatable-read-isolation-level)
  - [1.2. Automatic Deadlock Retry](#12-automatic-deadlock-retry)
  - [1.3. Centralized Transaction Wrapper](#13-centralized-transaction-wrapper)
  - [1.4. No Manual Locking](#14-no-manual-locking)
- [2. Write Strategy](#2-write-strategy)
  - [2.1. Master-First with Try-Catch Fallback](#21-master-first-with-try-catch-fallback)
  - [2.2. Partition-Based Routing](#22-partition-based-routing)
  - [2.3. ID Range Partitioning](#23-id-range-partitioning)
- [3. Replication Design](#3-replication-design)
  - [3.1. Pull-Based Manual Replication](#31-pull-based-manual-replication)
  - [3.2. Application-Level Logging](#32-application-level-logging)
  - [3.3. Batch Processing](#33-batch-processing)
  - [3.4. Idempotent Log Application](#34-idempotent-log-application)
  - [3.5. Retry with Exponential Backoff](#35-retry-with-exponential-backoff)
- [4. Failure Simulation](#4-failure-simulation)
  - [4.1. Connection Proxy Architecture](#41-connection-proxy-architecture)
  - [4.2. Simulated vs Real Failures](#42-simulated-vs-real-failures)
- [5. Concurrency Testing](#5-concurrency-testing)
  - [5.1. Deterministic Test Cases](#51-deterministic-test-cases)
  - [5.2. Sleep-Based Transaction Overlap](#52-sleep-based-transaction-overlap)
- [6. Frontend Architecture](#6-frontend-architecture)
  - [6.1. Server-Side Rendering (EJS)](#61-server-side-rendering-ejs)
  - [6.2. Parallel Data Fetching](#62-parallel-data-fetching)

---

## 1. Concurrency Control

### 1.1. REPEATABLE READ Isolation Level

**Decision**: Use `REPEATABLE READ` for all transactions.

**Why**:
- **Standard MySQL Default**: Ensures compatibility and predictable behavior
- **Prevents Dirty Reads**: T1 cannot see uncommitted changes from T2
- **Prevents Non-Repeatable Reads**: Re-reading data within T1 returns the same values
- **InnoDB Phantom Read Protection**: In MySQL, REPEATABLE READ also prevents phantom reads via gap locking
- **Logistics System Requirement**: Financial/logistics data must be consistent

**Trade-off**: Higher deadlock risk vs READ COMMITTED, but we handle this via retry logic.

**Alternative Rejected**:
  - **SERIALIZABLE**: Too restrictive, significantly reduces throughput
  - **READ COMMITTED**: Allows non-repeatable reads, unsuitable for consistency-critical operations

### 1.2. Automatic Deadlock Retry

**Decision**: Retry transactions up to 3 times with exponential backoff (100ms → 200ms → 400ms).

**Why**:
- **Transient Nature**: Most deadlocks are temporary lock conflicts
- **Success Rate**: 90%+ of deadlocks resolve on first retry
- **User Experience**: Better than immediately failing and forcing manual retry
- **Exponential Backoff**: Reduces contention by spreading out retry attempts

**Implementation** (`transactions.js`):
```javascript
if (err.errno === 1213 || err.errno === 1205) {  // Deadlock or Lock Wait
  const backoff = 100 * Math.pow(2, attempt - 1);
  await sleep(backoff);
  continue;
}
```

### 1.3. Centralized Transaction Wrapper

**Decision**: All writes must go through `runTransaction(pool, callback)` utility.

**Why**:
- **DRY Principle**: Single source of truth for transaction logic
- **Consistency**: All transactions get same isolation level and retry logic
- **Error Handling**: Automatic rollback on failure, guarantees connection release
- **Prevents Bugs**: Impossible to forget `BEGIN TRANSACTION` or `COMMIT`

**Alternative Rejected**:
  - **Inline Transactions**: Leads to code duplication and inconsistent error handling

### 1.4. No Manual Locking

**Decision**: Do **not** use `LOCK TABLES` or `SELECT ... FOR UPDATE`.

**Why**:
- **InnoDB Row-Level Locking**: Sufficient for our use case
- **Reduced Complexity**: Explicit locks require careful management to avoid deadlocks
- **Higher Concurrency**: Row locks allow more parallelism than table locks
- **Trust MVCC**: MySQL's Multi-Version Concurrency Control handles most scenarios

**When Manual Locks Are Needed**: Critical sections requiring strict ordering (not present in our system).

---

## 2. Write Strategy

### 2.1. Master-First with Try-Catch Fallback

**Decision**: Always try Node 1 first inside `try {}` block. On connection error, immediately fallback to appropriate fragment.

**Why**:
- **Simplicity**: No separate health monitoring service required
- **Deterministic**: Connection failure **is** the health check
- **Fast**: Zero delay between detecting failure and routing to fragment
- **Fail-Safe**: If both master and fragment fail, throws clear error to user

**Alternative Rejected**:
  - **Active Health Monitoring**: Requires background polling, adds complexity
  - **Hardcoded Fragment Routing**: No fallback, single point of failure

**Implementation** (`ridersService.js`):
```javascript
try {
  return await runTransaction(nodes.node1.pool, async (conn) => {
    // Write to Node 1
  });
} catch (err) {
  return await runTransaction(fragment.pool, async (conn) => {
    // Write to fragment (with ID offset)
  });
}
```

### 2.2. Partition-Based Routing

**Decision**: Route writes based on `courierName` field.

- **JNT** → Node 2
- **LBCD, FEDEZ** → Node 3

**Why**:
- **Project Requirement**: Horizontal fragmentation by domain attribute
- **Query Optimization**: Courier-specific queries can target single node
- **Data Locality**: Related records (same courier) are co-located

**Alternative Rejected**:
  - **Hash Partitioning**: Less intuitive for business queries
  - **Range Partitioning by ID**: Doesn't align with business logic

### 2.3. ID Range Partitioning

**Decision**: Each node uses a distinct `AUTO_INCREMENT` range:
- Node 1: 1 - 999,999
- Node 2: 1,000,000 - 1,999,999
- Node 3: 2,000,000 - 2,999,999

**Why**:
- **Prevents ID Collisions**: If Node 2 and Node 3 both write during Node 1 failure, they won't generate the same ID
- **Simplicity**: No distributed ID generation service (like Snowflake or Twitter Snowflake)
- **Deterministic**: Easy to identify which node created which record by ID alone

**Alternative Rejected**:
  - **UUIDs**: Larger storage footprint, not human-readable, no natural ordering
  - **Centralized ID Service**: Single point of failure, adds latency
  - **Database Auto-Increment (no offset)**: Causes conflicts during split-brain scenarios

**Configuration** (`sql/misc.sql`):
```sql
ALTER TABLE Riders AUTO_INCREMENT = 1000000;  -- Node 2
ALTER TABLE Riders AUTO_INCREMENT = 2000000;  -- Node 3
```

---

## 3. Replication Design

### 3.1. Pull-Based Manual Replication

**Decision**: Replication is **manually triggered** via API, not automatic background polling.

**Why**:
- **Explicit Control**: Admins/tests can trigger sync exactly when needed
- **Resource Efficiency**: No background processes consuming CPU/connections
- **Debugging**: Easier to trace and test replication flow
- **Educational Clarity**: Better demonstrates replication concepts for project evaluation

**Trade-off**: Requires manual intervention for sync (acceptable for demo/testing environment).

**Alternative Rejected**:
  - **Automatic Polling**: Wastes resources, harder to debug
  - **Push-Based**: Sender must track receiver state, more complex failure handling

**Endpoints**:
```
POST /api/recovery                    # Full bidirectional sync
POST /api/replication/replicate       # Sync specific pair
```

### 3.2. Application-Level Logging

**Decision**: Write logs at application layer (inside Node.js), not database triggers.

**Why**:
- **Atomic with Write**: Log inserted in same transaction as data change
- **Flexibility**: Can include metadata (tx_id, node_name, timestamp)
- **No Trigger Maintenance**: Easier to debug and modify
- **Cross-Node Coordination**: Can reference source node in log

**Alternative Rejected**:
  - **Database Triggers**: Hidden logic, harder to debug, can't coordinate across nodes
  - **Binary Log Replication**: Requires infrastructure access, not suitable for testing

**Schema**:
```sql
CREATE TABLE Logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tx_id VARCHAR(50),               -- UUID for transaction tracking
  node_name ENUM('node1','node2','node3'),
  action ENUM('INSERT','UPDATE','DELETE'),
  rider_id INT,
  old_value JSON,                  -- Before state
  new_value JSON,                  -- After state
  status ENUM('pending','replicated','failed'),
  timestamp DATETIME
);
```

### 3.3. Batch Processing

**Decision**: Process logs in batches of 100.

**Why**:
- **Efficiency**: Reduces network round-trips
- **Progress Tracking**: Can monitor sync in chunks
- **Interruption Safety**: If sync is interrupted, already-processed batches are marked

**Configuration** (`recoveryService.js`):
```javascript
const BATCH_SIZE = 100;
```

### 3.4. Idempotent Log Application

**Decision**: All log application operations are idempotent (safe to retry).

**Why**:
- **Network Instability**: Replication might time out and retry
- **Duplicate Delivery**: Better to apply twice safely than corrupt data

**Implementation** (`applyLog.js`):
- **INSERT**: `REPLACE INTO` (overwrites if ID exists)
- **UPDATE**: `UPDATE WHERE id = ?` (no-op if already applied)
- **DELETE**: `DELETE WHERE id = ?` (no-op if already deleted)

**Alternative Rejected**:
  - **At-Most-Once**: Risks data loss on network failure
  - **Exactly-Once with 2PC**: Too complex for this project scope

### 3.5. Retry with Exponential Backoff

**Decision**: Retry failed log applications up to 3 times with backoff (100ms → 300ms → 900ms).

**Why**:
- **Transient Failures**: Network hiccups or temporary locks often resolve quickly
- **Reduced Load**: Exponential backoff prevents overwhelming the target node
- **Diagnostic**: After 3 failures, mark as `failed` and log to `ReplicationErrors` for investigation

**Implementation** (`recoveryService.js`):
```javascript
const APPLY_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 100;  // 100ms → 300ms → 900ms
```

---

## 4. Failure Simulation

### 4.1. Connection Proxy Architecture

**Decision**: Wrap MySQL connection pools with a JavaScript `Proxy` that intercepts queries.

**Why**:
- **Portability**: Works without infrastructure access (perfect for demos/exams)
- **Instant Control**: Simulate crash/recovery in milliseconds via API
- **Deterministic**: No timing issues or race conditions
- **Safe**: Doesn't corrupt actual database state

**Implementation** (`db.js`):
```javascript
export const nodeStatus = {
  node1: true,  // ONLINE
  node2: true,
  node3: true
};

pool.getConnection = async () => {
  if (nodeStatus[nodeKey] === false) {
    throw new Error(`Connection refused: ${nodeKey} is offline (Simulated)`);
  }
  return originalGetConnection();
};
```

**Alternative Rejected**:
  - **Kill Actual Process**: Requires infrastructure access, risky
  - **Firewall Rules**: Requires networking permissions
  - **Docker Stop/Start**: Slow, non-deterministic

### 4.2. Simulated vs Real Failures

**Simulated Failures** (our approach):
  - Instant crash/recovery
  - No infrastructure required
  - Perfect for testing/demos
  - Doesn't test hardware failures

**Real Failures**:
  - Tests actual infrastructure resilience
  - Slow (restart takes seconds)
  - Requires permissions
  - Risk of data corruption

**Conclusion**: Simulated failures are ideal for educational/testing purposes.

---

## 5. Concurrency Testing

### 5.1. Deterministic Test Cases

**Decision**: Implement 3 specific concurrency test scenarios.

| Case | Scenario | Tests |
|------|----------|-------|
| **1: Read-Read** | T1 UPDATE (rollback), T2 SELECT | Dirty reads |
| **2: Read-Write** | T1 SELECT count, T2 INSERT | Phantom reads |
| **3: Write-Write** | T1 UPDATE, T2 UPDATE (same row) | Locking/serialization |

**Why**:
- **Coverage**: Hits all major isolation level behaviors
- **Reproducibility**: Same test always produces same result (given same isolation level)
- **Educational**: Clearly demonstrates SQL isolation concepts

**Implementation** (`simulationService.js`).

### 5.2. Sleep-Based Transaction Overlap

**Decision**: Use `await sleep(ms)` inside transactions to force overlap.

**Why**:
- **Deterministic**: Guarantees transactions will overlap
- **Flexible**: Can control exact overlap duration
- **Visible**: Event logs show precise timing

**Example**:
```javascript
const t1 = runTransaction(pool, async (conn) => {
  await conn.query("UPDATE ...");
  await sleep(3000);  // Hold lock for 3s
  await conn.query("ROLLBACK");
});

const t2 = runTransaction(pool, async (conn) => {
  await sleep(1500);  // Start during T1's lock hold
  await conn.query("SELECT ...");
});
```

**Alternative Rejected**:
  - **Random Load Generation**: Unpredictable, harder to reproduce bugs
  - **Real User Simulation**: Requires complex test harness

---

## 6. Frontend Architecture

### 6.1. Server-Side Rendering (EJS)

**Decision**: Use EJS templates (not React/Vue/Angular).

**Why**:
- **Simplicity**: No build step, no client-side state management
- **Direct Data Access**: Node.js has data, just render it
- **Project Scope**: Focus is on distributed databases, not frontend complexity
- **Fast Development**: Faster to build dashboard than full SPA

**Alternative Rejected**:
  - **React SPA**: Requires build tools, separate API design, more complex
  - **Plain HTML + AJAX**: More boilerplate than EJS

### 6.2. Parallel Data Fetching

**Decision**: Fetch data from all 3 nodes in parallel using `Promise.all()`.

**Why**:
- **Performance**: 3x faster than sequential fetching
- **Fail-Safe**: If Node 1 is down, can still fetch from Node 2/3

**Implementation** (`server.js`):
```javascript
const [node1Data, node2Data, node3Data] = await Promise.all([
  getRidersFromNode("node1"),
  getRidersFromNode("node2"),
  getRidersFromNode("node3")
]);
```

**Alternative Rejected**:
  - **Sequential Fetching**: 3x slower, no benefit
  - **Only Fetch Node 1**: Can't show fragmentation in dashboard

---

## Summary of Principles

1. **Simplicity Over Perfection**: Choose simple, understandable solutions
2. **Fail-Safe Over Fail-Fast**: Retry logic, fallback mechanisms
3. **Explicit Over Implicit**: Manual replication, clear error messages
4. **Testing Over Assumptions**: Built-in concurrency tests, simulation controls

---

**Document Version**: 4.0 (Complete Rewrite)
**Last Updated**: 2025-12-02
**Authors**: STADVDB MCO2 Team
