# DESIGN_DECISIONS_EXPANDED.md <!-- omit from toc -->

This document explains the _why_ behind every architectural decision.
It is meant to serve as a deep reference for the concurrency, replication, and recovery design of the distributed database system.

**Purpose**: Technical reference for project documentation and team understanding.

---

## Table of Contents <!-- omit from toc -->

- [1. Concurrency Design](#1-concurrency-design)
  - [1.1. Isolation Level: REPEATABLE READ](#11-isolation-level-repeatable-read)
  - [1.2. Deadlock Policy](#12-deadlock-policy)
  - [1.3. Transaction Wrapper](#13-transaction-wrapper)
  - [1.4. No Explicit SQL Locks](#14-no-explicit-sql-locks)
  - [1.5. No Read Logging](#15-no-read-logging)
  - [1.6. Removal of All MySQL Triggers](#16-removal-of-all-mysql-triggers)
  - [1.7. Application-Level Logging (Final Design)](#17-application-level-logging-final-design)
- [2. Replication Design](#2-replication-design)
  - [2.1. Replication Interval: Every 5 Seconds](#21-replication-interval-every-5-seconds)
  - [2.2. Replication Mode: Pull-Based (Recommended)](#22-replication-mode-pull-based-recommended)
    - [2.2.1. Pull Model Responsibilities](#221-pull-model-responsibilities)
    - [2.2.2. Why Pull is better](#222-why-pull-is-better)
  - [2.3. Multi-Master, Conflict-Free](#23-multi-master-conflict-free)
  - [2.4. Bidirectional Replication](#24-bidirectional-replication)
  - [2.5. Partition-Based Filtering (Critical Innovation)](#25-partition-based-filtering-critical-innovation)
    - [2.5.1. The Problem: Replication Starvation](#251-the-problem-replication-starvation)
    - [2.5.2. The Solution: SQL-Level Filtering](#252-the-solution-sql-level-filtering)
    - [2.5.3. Implementation Details](#253-implementation-details)
    - [2.5.4. Why This Matters](#254-why-this-matters)
  - [2.6. Log Status Lifecycle](#26-log-status-lifecycle)
  - [2.7. Batch Size: 100 Logs](#27-batch-size-100-logs)
  - [2.8. applyLogToNode Never Creates Logs](#28-applylogtonode-never-creates-logs)
- [3. Recovery Design](#3-recovery-design)
  - [3.1. Pairwise Synchronization](#31-pairwise-synchronization)
  - [3.2. Missing Logs = max(log.id)](#32-missing-logs--maxlogid)
  - [3.3. No Distributed Locks](#33-no-distributed-locks)
  - [3.4. Idempotent Reapplication](#34-idempotent-reapplication)
  - [3.5. Failover-Safe](#35-failover-safe)
- [4. Summary Table](#4-summary-table)

---

## 1. Concurrency Design

### 1.1. Isolation Level: REPEATABLE READ

We enforce **REPEATABLE READ per transaction** across all nodes.

Reasons:

- Provides snapshot isolation without the overhead of SERIALIZABLE.
- Prevents non-repeatable reads during multi-statement operations.
- Works best with MySQL’s MVCC engine (InnoDB).
- Avoids phantom reads for simple CRUD workloads (we do not run complex range queries).

Serializable isolation was rejected because:

- It adds unnecessary locking overhead.
- It can introduce more deadlocks than it prevents.
- Our workload is OLTP-friendly, not analytical.

---

### 1.2. Deadlock Policy

Deadlock handling:

- **2 retries**
- **3 attempts total**
- **100ms, then 200ms exponential backoff**

Why:

- Deadlocks occur mostly during concurrent updates to the same rider.
- Retrying is the industry-standard approach (e.g., MySQL, JDBC, MongoDB drivers).
- Backoff prevents retry storms.

---

### 1.3. Transaction Wrapper

All writes use `runTransaction(pool, cb)`

This guarantees:

- Isolation level applied per connection.
- Commit/rollback handling.
- Automatic deadlock retries.
- Consistent lifecycle management.

No developer can "forget" to start or commit a transaction.

---

### 1.4. No Explicit SQL Locks

We do **not** use:

- `SELECT … FOR UPDATE`
- `LOCK TABLES`
- Advisory locks

Reasons:

- InnoDB row-level locking + MVCC are already sufficient.
- Manual locks increase chance of deadlocks.
- Simpler and more maintainable.

---

### 1.5. No Read Logging

Reads do not change state, so we do not log them.

Benefits:

- Keeps Logs table small.
- Replication remains completely write-driven.
- No wasted CPU or storage on no-op log entries.

---

### 1.6. Removal of All MySQL Triggers

We removed triggers entirely.

Reasons:

- Triggers cannot coordinate with remote nodes.
- They hide writes and make debugging extremely hard.
- They cannot batch-protect writes under a single app-level transaction.
- Application-level logging is more predictable and transparent.

---

### 1.7. Application-Level Logging (Final Design)

Logging is done **only** by the application during writes.

Each multi-statement write maps to **one tx_id**, guaranteeing:

- Atomicity between the main write and the log record.
- Ordered logs across all nodes.
- Easier replication bookkeeping.

---

## 2. Replication Design

### 2.1. Replication Interval: Every 5 Seconds

We run replication periodically at **5-second intervals**.

Why:

- Balances latency and load.
- Frequent enough for eventual consistency.
- Light enough to avoid overwhelming DB nodes.

---

### 2.2. Replication Mode: Pull-Based (Recommended)

Each node _pulls_ logs from the source nodes instead of pushing.

#### 2.2.1. Pull Model Responsibilities

- **Node1 pulls from Node2 and Node3**
- **Node2 pulls from Node1**
- **Node3 pulls from Node1**

#### 2.2.2. Why Pull is better

1. **Eliminates push storms**
   Nodes never force-write into another node.

2. **Centralizes responsibility**
   Each node is responsible for its own replication cycle.

3. **Pull is the industry standard**
   Used by MySQL async replication, MongoDB replica sets, Kafka consumers.

4. **Cleaner error handling**
   Source node never has to worry about destination node failures.

5. **Logs stay node-local**
   No cross-node log storage.

6. **Nodes 2 and 3 never talk to each other**
   Maintains strict fragment separation.

Push model was rejected because:

- It can create multiple simultaneous writes to the same destination.
- Harder to ensure only one replicator writes at a time.
- Error feedback becomes complicated.

---

### 2.3. Master-Slave with Automatic Failover

**Design Choice**: Node 1 is the master during normal operation; Node 2/3 are slaves that automatically promote during Node 1 failure.

**Why Master-Slave?**

1. **Simplicity**: Single write point eliminates complex conflict resolution
2. **Consistency**: Stronger consistency guarantees than multi-master
3. **Industry Standard**: Well-understood pattern (MySQL, PostgreSQL)
4. **Easier Debugging**: Clear data flow and ownership

**Why Automatic Failover?**

1. **High Availability**: System continues accepting writes during Node 1 failure
2. **Partition-Aware**: JNT and non-JNT writes remain independent
3. **No Manual Intervention**: Automatic promotion/demotion reduces downtime
4. **Academic Demonstration**: Shows understanding of fault tolerance

**Failover Mechanism:**

- **Health Monitoring**: 5-second intervals, 3 consecutive failures = Node 1 down
- **Automatic Promotion**: Node 2/3 become masters for their partitions
- **Write Distribution**: JNT → Node 2, non-JNT → Node 3
- **No Inter-Slave Replication**: Partitions are mutually exclusive
- **Automatic Recovery**: Node 1 pulls logs from Node 2/3 when returning
- **Automatic Demotion**: Node 2/3 return to slave role after Node 1 recovers

**Trade-offs:**

| Aspect | Master-Slave | Multi-Master (Previous) |
|--------|--------------|------------------------|
| Write Availability | Partial during failover | High (2 independent writers) |
| Complexity | Low | Medium (partition filtering) |
| Consistency | Stronger | Eventual |
| Conflict Resolution | Not needed | Not needed (partitioned) |
| Single Point of Failure | Yes (Node 1) | No |

**Why This is Better for Academic Project:**

- Demonstrates understanding of both architectures
- Shows automatic failover implementation
- Simpler to explain and demonstrate
- Still provides high availability through failover
- Avoids over-engineering for project scope

---

### 2.4. Bidirectional Replication (During Recovery Only)

Replication occurs in both directions:

- Node1 ↔ Node2
- Node1 ↔ Node3

This ensures:

- No single point of knowledge.
- Node1 can rebuild after outages.
- Nodes 2 and 3 can rebuild after outages.

Node2 and Node3 do **not** replicate with each other.

---

### 2.5. Partition-Based Filtering (Critical Innovation)

#### 2.5.1. The Problem: Replication Starvation

**Initial Issue Discovered:**

When Node 2 or Node 3 pulled logs from Node 1, they would fetch **ALL** pending logs, including logs that didn't belong to their partition:

- Node 2 (JNT partition) would pull logs for LBCD and FEDEZ couriers
- Node 3 (non-JNT partition) would pull logs for JNT couriers

This caused:

1. **Infinite replication loops**: Nodes would repeatedly fetch irrelevant logs
2. **Wasted bandwidth**: Transferring data that would be rejected
3. **Replication starvation**: Batch limits (100 logs) could be filled with irrelevant data
4. **Potential data corruption**: Risk of applying logs to wrong partitions

#### 2.5.2. The Solution: SQL-Level Filtering

**Design Decision**: Implement partition-aware filtering **at the SQL query level** when Node 1 replicates to Node 2 or Node 3.

**Key Insight**: The filtering must happen **during log fetching**, not during application.

**Directional Filtering Rules**:

| Direction | Filtering Applied? | Reason |
|-----------|-------------------|--------|
| Node 2 → Node 1 | No | Node 1 accepts all logs (aggregation node) |
| Node 3 → Node 1 | No | Node 1 accepts all logs (aggregation node) |
| Node 1 → Node 2 | Yes | Only send JNT logs to Node 2 |
| Node 1 → Node 3 | Yes | Only send non-JNT logs to Node 3 |

#### 2.5.3. Implementation Details

**Function**: `getPendingLogsFromSource(source, targetName, limit)`

**Logic**:

```javascript
if (source.name === "node1") {
  if (targetName === "node2") {
    // Filter for JNT only
    filterClause = `
      AND (
        (new_value IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.courierName')) = 'JNT')
        OR
        (new_value IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(old_value, '$.courierName')) = 'JNT')
      )
    `;
  } else if (targetName === "node3") {
    // Filter for non-JNT only
    filterClause = `
      AND (
        (new_value IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.courierName')) != 'JNT')
        OR
        (new_value IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(old_value, '$.courierName')) != 'JNT')
      )
    `;
  }
}
```

**Why check both `new_value` and `old_value`?**

- **INSERT/UPDATE**: `new_value` contains the courier name
- **DELETE**: `new_value` is NULL, so we check `old_value` to determine partition

**SQL Query Example (Node 1 → Node 2)**:

```sql
SELECT * FROM Logs
WHERE status = 'pending'
  AND (
    (new_value IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.courierName')) = 'JNT')
    OR
    (new_value IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(old_value, '$.courierName')) = 'JNT')
  )
ORDER BY id ASC
LIMIT 100
```

#### 2.5.4. Why This Matters

**Benefits**:

1. **Prevents replication starvation**: Nodes only fetch relevant logs
2. **Maintains partition integrity**: No cross-partition data leakage
3. **Improves efficiency**: Reduces unnecessary network traffic
4. **Ensures correctness**: Each node only processes data it's responsible for
5. **Scalable design**: Can easily add more partitions with same pattern

**Alternative Approaches Rejected**:

- **Application-level filtering**: Would still waste bandwidth fetching irrelevant logs
- **Separate log tables per partition**: Adds complexity, harder to maintain
- **Post-fetch filtering**: Wastes batch quota on irrelevant logs

**Testing Verification**:

Unit tests in `tests/integration/full_suite.test.js` verify:
- Node 2 only receives JNT logs from Node 1
- Node 3 only receives non-JNT logs from Node 1
- DELETE operations are correctly filtered by `old_value`

---

### 2.6. Log Status Lifecycle

Each log has one of three statuses:

| Status     | Meaning                                           |
| ---------- | ------------------------------------------------- |
| pending    | Write committed but not applied everywhere needed |
| replicated | Fully applied to all required nodes               |
| failed     | Replication attempt failed                        |

Failed logs require **manual retry**.

---

### 2.7. Batch Size: 100 Logs

Logs are processed in batches of 100.

Why:

- **Efficient network utilization**: Reduces round trips
- **Prevents infinite loops**: Limits processing per cycle
- **Industry standard**: Matches typical MySQL batch processing guidelines
- **Memory management**: Prevents loading excessive logs into memory
- **Predictable performance**: Consistent processing time per batch

**Trade-offs Considered**:

- **Smaller batches (e.g., 10)**: More overhead, slower convergence
- **Larger batches (e.g., 1000)**: Memory pressure, longer transactions
- **100 is the sweet spot**: Balances throughput and resource usage

---

### 2.8. applyLogToNode Never Creates Logs

Replicated writes **do not** generate new logs.

This prevents:

- Infinite replication loops
- Log storms
- Cross-node cascaded writes

The log is applied silently using:

- `REPLACE` for inserts
- Full-row snapshots for updates
- Standard deletes for deletes

All operations are **idempotent**.

---

## 3. Recovery Design

### 3.1. Pairwise Synchronization

Recovery always happens in isolated pairs:

- Node1 ↔ Node2
- Node1 ↔ Node3

We intentionally do **not** do:

- Three-way reconciliation
- Global ledger ordering

Pairwise sync is simpler and avoids:

- Split-brain logic
- Multi-source conflict trees

---

### 3.2. Missing Logs = max(log.id)

Each node determines missing logs by comparing the max id it has seen from the other node.

We do NOT use:

- Vector clocks
- Lamport timestamps
- Epoch-based counters

Why:

- Logs are append-only and monotonic.
- Partitioning ensures no conflicting writes.
- Simpler model increases reliability.

---

### 3.3. No Distributed Locks

We avoid:

- Cross-node advisory locks
- Global mutexes
- Consensus protocols

Unnecessary because:

- Writes from Node2 and Node3 never collide.
- Replication is ordered and idempotent.
- Node1 always catches up with deterministic replay.

---

### 3.4. Idempotent Reapplication

Every replicated action can safely be applied multiple times due to:

- `REPLACE INTO` insert semantics
- UPDATE uses full-row snapshots
- DELETE targets primary key only

This property allows:

- Replays after partial failures
- Recovery after replication interruption
- Simple retry logic

---

### 3.5. Failover-Safe

If Node1 goes down:

- Node2 and Node3 keep writing normally.
- Their logs remain consistent.
- Once Node1 returns, pull-based replication restores it.

The partition rule ensures write sets never overlap.

---

## 4. Summary Table

| Component | Decision | Why | Alternative Rejected |
|-----------|----------|-----|---------------------|
| **Isolation Level** | REPEATABLE READ | Balanced safety + performance, prevents non-repeatable reads | SERIALIZABLE (too strict, more deadlocks) |
| **Deadlocks** | Retry 2 times, exponential backoff | Industry standard, handles transient conflicts | No retries (poor UX), infinite retries (loops) |
| **Logging** | Application-level only | Full control, transparent, simple | Triggers (hidden writes, coordination issues) |
| **Triggers** | Removed entirely | Hidden writes cause chaos, can't coordinate multi-node | Keep triggers (rejected for complexity) |
| **Replication** | Pull-model | Reliable, scalable, industry standard | Push-model (storms, coordination issues) |
| **Interval** | 5 seconds | Reasonable consistency lag | Real-time (too expensive), 1 minute (too slow) |
| **Batch size** | 100 logs | Efficient transport, manageable memory | 10 (slow), 1000 (memory pressure) |
| **Partition Filtering** | SQL-level, directional | Prevents starvation, maintains integrity | App-level (wastes bandwidth), no filtering (loops) |
| **Conflict handling** | None required | Strict partitioning eliminates conflicts | Vector clocks (unnecessary complexity) |
| **Recovery algorithm** | Pairwise synchronization | Simple, predictable, deterministic | Three-way reconciliation (complex) |
| **Ordering** | MAX(log.id) | Lightweight, append-only logs | Lamport timestamps (overkill) |
| **Distributed locks** | None | Partitioned writes make them unnecessary | Global locks (single point of failure) |
| **Replays** | Idempotent (REPLACE, snapshots) | Safe replication & recovery | Non-idempotent (dangerous retries) |
| **Node topology** | Star (Node 1 hub) | Centralized reads, distributed writes | Mesh (too complex), chain (slow) |
| **Write routing** | Fragment-aware (by courier) | Automatic partitioning, no conflicts | Manual routing (error-prone) |
| **Failed logs** | Manual retry via admin API | Prevents automatic error propagation | Auto-retry (could amplify errors) |

---

## 5. Key Innovations

### 5.1. Partition-Based Filtering

**Innovation**: SQL-level filtering during log fetching based on target node's partition responsibility.

**Impact**: Eliminates replication starvation, maintains partition integrity, improves efficiency.

### 5.2. Conflict-Free Multi-Master

**Innovation**: Strict partitioning eliminates write conflicts without complex resolution algorithms.

**Impact**: High availability without vector clocks, LWW, or consensus protocols.

### 5.3. Application-Level Logging

**Innovation**: Atomic logging with main writes, no triggers, full transparency.

**Impact**: Predictable replication, easier debugging, multi-node coordination.

### 5.4. Pull-Based Replication

**Innovation**: Each node pulls logs from partners instead of receiving pushes.

**Impact**: No push storms, centralized responsibility, cleaner error handling.

### 5.5. ID Range Partitioning

**Problem**: During failover, Node 2 and Node 3 operate independently using their own AUTO_INCREMENT sequences. This causes ID collisions when both assign the same ID to different riders.

**Solution**: Allocate distinct ID ranges to each node:
- Node 1: 1 - 999,999
- Node 2: 1,000,000 - 1,999,999
- Node 3: 2,000,000 - 2,999,999

**Implementation**:
```sql
-- During cleanup/initialization
ALTER TABLE Riders AUTO_INCREMENT = 1;        -- Node 1
ALTER TABLE Riders AUTO_INCREMENT = 1000000;  -- Node 2
ALTER TABLE Riders AUTO_INCREMENT = 2000000;  -- Node 3
```

**Why This Works**:
1. **Zero coordination overhead** - No distributed locks or consensus
2. **MySQL-native** - Uses built-in AUTO_INCREMENT feature
3. **No schema changes** - ID column remains INT (supports 2.1 billion)
4. **Failover-safe** - Each node can operate independently
5. **Simple to understand** - Clear visual separation in data

**Trade-offs**:
- IDs are not sequential across the system (acceptable for most applications)
- Fixed capacity per node (1M IDs, easily increased if needed)
- ID reveals which node created the record (could be a feature for debugging)

**Alternative Approaches Rejected**:
1. **UUIDs** - Larger storage (16 bytes vs 4), slower indexing, not human-readable
2. **Snowflake IDs** - Requires synchronized clocks, more complex
3. **Centralized ID server** - Single point of failure, network overhead
4. **Interleaved IDs (modulo)** - Non-sequential, harder to debug

**Impact**: Eliminates ID collisions with minimal complexity, maintaining performance and debuggability.

---

## 6. Future Enhancements

Potential improvements for production deployment:

1. **Automatic replication scheduling**: Background job instead of manual triggers
2. **Compression**: Compress log batches for network efficiency
3. **Parallel replication**: Process multiple batches concurrently
4. **Monitoring**: Prometheus metrics for replication lag
5. **Auto-retry**: Exponential backoff for failed logs
6. **Partition rebalancing**: Dynamic partition assignment
7. **Read replicas**: Add read-only nodes for scaling
8. **Dynamic ID ranges**: Adjust ranges based on write patterns

---

**Document Version**: 3.0
**Last Updated**: 2025-11-30
**Authors**: STADVDB MCO2 Team
