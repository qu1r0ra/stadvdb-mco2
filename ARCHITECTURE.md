# Project Architecture

## 1. Overview

This system implements a **fault-tolerant master-slave distributed database** with:

- **Master-slave replication** with automatic failover
- **Concurrent multi-user access** with REPEATABLE READ isolation
- **Application-level write-ahead logging** for durability
- **Automatic health monitoring** and failure detection
- **Partition-aware failover** (JNT vs. non-JNT couriers)
- **Automatic deadlock handling** with exponential backoff
- **Eventually consistent recovery** with catch-up synchronization

The platform consists of:

- **Backend**: Node.js (v20.18.0+) + Express + MySQL2
- **Data storage**: Three remote MySQL 8.0 VMs
- **Node roles**:
  - **Node 1 (Master)**: Handles ALL writes during normal operation, primary read node
  - **Node 2 (Slave)**: Read-only replica, promoted to master for JNT writes during Node 1 failure
  - **Node 3 (Slave)**: Read-only replica, promoted to master for non-JNT writes during Node 1 failure
- **Replication model**: Unidirectional (master → slaves) during normal operation, bidirectional during recovery

---

## 2. Concurrency Model

### 2.1 Isolation Level

All transactions run under **REPEATABLE READ**. This is explicitly set per transaction.

### 2.2 Deadlock Strategy

- **Two retries** using exponential backoff
- Backoff: 100ms → 200ms → fail
- Third attempt fails immediately

### System Components

- **`/services`** — Business logic (CRUD operations, replication, recovery, simulation)
- **`/routes`** — Express API endpoints (riders, recovery, replication admin, test)
- **`/utils`** — Transaction manager, logging utilities, helper functions
- **`/views`** — EJS templates for the web dashboard
- **`/public`** — Static assets (CSS, client-side JS)
- **`/scripts`** — Database initialization and test suite
- **`/tests`** — Integration test suite
- **`/sql`** — Schema definitions, triggers (deprecated), misc utilities

### 2.3 Transaction Management

All writes use `runTransaction(pool, cb)`.

Responsible for:

- Setting isolation level
- Starting/committing/rolling back transactions
- Handling deadlocks
- Ensuring cleanup

### 2.4 No SQL-Level Locks

System relies on:

- MVCC
- InnoDB row-level locks
- Snapshot isolation

No SERIALIZABLE or explicit table locking.

---

## 3. Logging Architecture

### 3.1 Removal of Triggers

Triggers removed because:

- They cannot coordinate multi-node replication
- Hidden writes complicate replication ordering
- Impossible to atomically batch app logic + triggers across nodes

### 3.2 Application-Level Logging

Every write creates one log entry:

| Column    | Meaning                   |
| --------- | ------------------------- |
| id        | sequential log id         |
| tx_id     | per-client transaction id |
| node_name | origin of write           |
| action    | INSERT/UPDATE/DELETE      |
| rider_id  | PK target                 |
| old_value | JSON before               |
| new_value | JSON after                |
| status    | pending/replicated/failed |
| timestamp | creation time             |

Logs are **atomic** with main writes.

### 3.3 No Read Logging

Reads do not mutate state → no need to log.

---

## 4. Replication Architecture

### 4.1 Normal Operation (Node 1 = Master)

Replication is **on-demand** and **manually triggered** via API endpoints:
- `POST /api/replication/replicate` - Sync specific pair (source/target)
- `POST /api/recovery` - Run full bidirectional sync (node1 ↔ node2, node1 ↔ node3)

Batch-based (100 logs per sync).

### 4.2 Failover Mode (Node 1 Down)

**Automatic Failover Trigger:**
- Health check detects Node 1 unavailable (every 5 seconds)
- Node 2 and Node 3 automatically promote to masters

- Node2 handles JNT exclusively
- Node3 handles others exclusively
- Node1 aggregates but does not originate partition-specific writes during normal operation

No rider can be modified by two writer nodes simultaneously.

### 4.3 Recovery Mode (Node 1 Returns)

When triggered (manually via API):
1. Fetch pending logs (`status = 'pending'`)
2. Apply sequentially
3. On success: mark `replicated`
4. On failure: mark `failed` and stop

**Manual Demotion Fallback:**
- If automatic demotion fails, use `POST /api/failover/demote`
- Allows manual control in edge cases

### 4.4 Idempotent Application

`applyLogToNode` ensures safe retries and recovery:

- **INSERT**: Uses `REPLACE INTO` (upsert by primary key)
- **UPDATE**: Applies full row snapshot (deterministic)
- **DELETE**: Removes by primary key only

All operations are **idempotent** and can be safely replayed during recovery.

### 4.5 Failed Log Handling

- Stored as `status = 'failed'` in source node's Logs table
- Diagnostic details recorded in `ReplicationErrors` table
- Manual retry available via `/api/replication/retry-failed` endpoint
- Batch processing halts on first failure to maintain ordering

---

## 5. Fault Tolerance & High Availability

### 5.1 Health Monitoring

**Health Check Mechanism:**
- Periodic health checks every 5 seconds
- Checks database connectivity: `SELECT 1` query
- Tracks Node 1 availability status

**Failure Detection:**
- 3 consecutive failed health checks → Node 1 considered down
- Triggers automatic failover to Node 2/3

### 5.2 Failover Guarantees

**Write Availability:**
- Normal operation: 100% (Node 1 handles all writes)
- Node 1 failure: Partial (Node 2 for JNT, Node 3 for non-JNT)
- Node 2 failure: 100% (Node 1 handles all writes)
- Node 3 failure: 100% (Node 1 handles all writes)

**Read Availability:**
- Normal operation: Node 1 (primary), fallback to Node 2/3
- Node 1 failure: Route by partition (Node 2 for JNT, Node 3 for non-JNT)

### 5.3 Split-Brain Mitigation

**Known Limitation:**
- Network partitions not handled (acceptable for academic project)
- Assumes stable network connectivity

**Conflict Resolution:**
- Uses Last-Write-Wins (LWW) based on log timestamps
- Simpler than quorum/fencing mechanisms
- Documented as future enhancement

---

## 6. Fault-Tolerance Model

### 6.1 Normal Operation

- All writes **try Node 1 first** (master)
- On success, log is created for async replication (manual trigger)
- Reads prefer Node1, fallback to merged Node2+Node3

### 6.2 Node1 Failure (Simulated)

- Connection to Node 1 throws error (via `nodeStatus` proxy)
- `ridersService.js` catches error and immediately routes to:
  - Node 2 (if `courierName === 'JNT'`)
  - Node 3 (if `courierName !== 'JNT'`)
- Write succeeds with ID range 1M+ (Node 2) or 2M+ (Node 3)
- Log is created on the fragment node for later sync back to Node 1

### 6.3 Recovery

- When Node 1 "comes back" (via `POST /api/test/node-status` with `status: true`)
- Manual trigger of `POST /api/recovery` syncs:
  - Node 2 → Node 1 (missed JNT logs)
  - Node 3 → Node 1 (missed Other logs)
- Node 1 → Node 2/3 (any logs created on Node 1 during recovery)

### 6.4 Safety Guarantee

No conflicting writes due to:
- Partition rules (JNT vs Others)
- ID range partitioning (prevents collisions)
- Try-catch routing (deterministic destination)

---

## 6. API Overview

### `/riders`

**Normal Operation (Node 1 = Master):**
- All writes routed to Node 1
- Reads from Node 1 (primary), fallback to Node 2+3 merge

**Failover Mode (Node 1 Down):**
- Writes routed by courier: JNT → Node 2, others → Node 3
- Reads routed by courier: JNT → Node 2, others → Node 3

### `/recovery`

Triggers synchronization:
- Normal: Node 1 → Node 2/3 (unidirectional)
- Recovery: Node 2/3 → Node 1 (catch-up)

### `/replication`

Admin tools:
- Monitor pending/failed logs
- Retry failed replications
- Force synchronization

### `/failover` (New)

**Manual failover control:**
- `POST /api/replication/promote` - Manually promote Node 2/3 to masters
- `POST /api/replication/demote` - Manually demote Node 2/3 to slaves
- `GET /api/replication/failover-status` - Check current master/slave status

### `/testing` (New)

**Testing utilities:**
- `POST /api/replication/cleanup` - Clear all tables and reset AUTO_INCREMENT offsets
- `GET /api/replication/consistency-check` - Verify Node 1 data matches Node 2+3 combined

---

## 7. ID Range Partitioning

### 7.1 Problem: Auto-Increment Collisions

During failover, Node 2 and Node 3 operate independently and may assign the same IDs to different riders, causing conflicts when Node 1 recovers.

### 7.2 Solution: Range-Based Partitioning

Each node uses a distinct AUTO_INCREMENT offset:

- **Node 1**: 1 - 999,999
- **Node 2**: 1,000,000 - 1,999,999
- **Node 3**: 2,000,000 - 2,999,999

**Implementation**: During cleanup, `ALTER TABLE Riders AUTO_INCREMENT = <offset>` is executed on each node.

**Benefits**:
- Zero application code changes
- Globally unique IDs across all nodes
- No coordination overhead
- 1 million IDs per node (sufficient for typical workloads)

### `/failover` (New)

**Manual failover control:**
- `POST /api/replication/promote` - Manually promote Node 2/3 to masters
- `POST /api/replication/demote` - Manually demote Node 2/3 to slaves
- `GET /api/replication/failover-status` - Check current master/slave status

### `/testing` (New)

**Testing utilities:**
- `POST /api/replication/cleanup` - Clear all tables and reset AUTO_INCREMENT offsets
- `GET /api/replication/consistency-check` - Verify Node 1 data matches Node 2+3 combined

---

## 8. Simulation Architecture

To meet the project requirements for demonstrating failure recovery and concurrency control without physical hardware manipulation, we implemented a simulation layer.

### 8.1 Connection Proxy (`src/config/db.js`)

We wrap the MySQL connection pools with a custom Proxy. This allows us to intercept every `getConnection` and `query` call.

- **Mechanism**: A global `nodeStatus` object tracks the state (ONLINE/OFFLINE) of each node.
- **Interception**: Before executing any query, the proxy checks `nodeStatus`.
- **Simulation**: If a node is marked OFFLINE, the proxy throws a `Connection refused` error, mimicking a real network or server failure.

### 8.2 Concurrency Testing (`src/services/simulationService.js`)

We implemented a service to deterministically test transaction isolation levels.

- **Case 1 (Read-Read)**: Two concurrent transactions read the same data. Used to verify shared locks (if any) or non-blocking reads.
- **Case 2 (Read-Write)**: One transaction reads while another writes. Used to verify `REPEATABLE READ` vs `READ COMMITTED`.
- **Case 3 (Write-Write)**: Two concurrent transactions update the same row. Used to verify locking behavior and wait timeouts.

These tests run against the actual database but use `sleep()` to artificially extend transaction duration and force overlaps.

---

## 9. ID Range Partitioning

---

## 10. Summary of Guarantees

### 8.1 Correctness Guarantees

- **No lost updates**: All writes are logged atomically
- **Durability**: Logs ensure recoverability even after crashes
- **Idempotent replication**: Safe to replay operations during recovery
- **Eventual consistency**: All nodes converge after failover recovery
- **Last-Write-Wins**: Timestamp-based conflict resolution
- **Globally unique IDs**: Range partitioning prevents ID collisions

### 8.2 Availability Guarantees

- **Master-slave with failover**: Node 1 failure triggers automatic promotion
- **Partition-level availability**: JNT and non-JNT writes remain independent
- **Automatic deadlock recovery**: 2 retries with exponential backoff
- **Graceful degradation**: Partial write availability during Node 1 failure

### 8.3 Performance Characteristics

- **Batch-based replication**: Efficient network utilization (100 logs/batch)
- **Unidirectional replication**: Reduced overhead during normal operation
- **REPEATABLE READ isolation**: Balanced consistency and concurrency
- **Health monitoring**: 5-second intervals, minimal overhead

### 8.4 Operational Guarantees

- **Transparent logging**: Application-level, no hidden triggers
- **Observable failures**: Failed logs tracked in `ReplicationErrors`
- **Manual intervention**: Admin endpoints for failover control
- **Automatic recovery**: Node 1 catches up from slaves when returning
- **Consistency verification**: Endpoint to verify data integrity across nodes
