# Project Architecture

## 1. Overview

This system implements a **fault-tolerant, multi-node distributed database** with:

- **Fragmented data storage**
- **Concurrent multi-user access**
- **Application-level write-ahead logging**
- **Bidirectional replication**
- **Automatic deadlock handling**
- **Master-slave-but-promotable architecture**
- **Eventually consistent recovery**

The platform consists of:

- **Backend**: Node.js + MySQL2
- **Data storage**: Three remote MySQL VMs
- **Fragmentation strategy**:
  - Node 2: all `courierName = 'JNT'`
  - Node 3: all `courierName != 'JNT'`
  - Node 1: central reference + consolidation target
- **Replication model**: Logical, log-based, application-driven

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

### 4.1 Behavior

Replication is **on-demand** and **manually triggered** via API endpoints:
- `POST /api/replication/replicate` - Sync specific pair (source/target)
- `POST /api/recovery` - Run full bidirectional sync (node1 ↔ node2, node1 ↔ node3)

Batch-based (100 logs per sync).

### 4.2 Conflict-Free Design

Partition rules prevent conflicts:

- Node2 handles JNT exclusively
- Node3 handles others exclusively
- Node1 aggregates but does not originate partition-specific writes during normal operation

No rider can be modified by two writer nodes simultaneously.

### 4.3 Replication Process

When triggered (manually via API):
1. Fetch pending logs (`status = 'pending'`)
2. Apply sequentially
3. On success: mark `replicated`
4. On failure: mark `failed` and stop

### 4.4 Idempotent applyLogToNode

- INSERT uses `REPLACE`
- UPDATE applies full row snapshot
- DELETE removes id reliably

Safe for retries.

### 4.5 Failed Log Handling

- Stored as `status = 'failed'`
- Added to `ReplicationErrors`
- Retries allowed via admin endpoint

---

## 5. Recovery Architecture

### 5.1 Entry Point

`POST /api/recovery`

Runs full:

- node1 ↔ node2
- node1 ↔ node3

### 5.2 Algorithm

1. Check target max log id
2. Fetch missing logs from source
3. Apply with retry logic
4. Update status

### 5.3 No Distributed Locks

Append-only log and fragmentation guarantee no conflicts.

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

## 7. API Overview

### `/riders`

- Write routed to correct fragment based on courier
- Reads prefer Node1, fallback to Node2+Node3 merge

### `/recovery`

Runs full synchronization.

### `/replication`

Admin tools for pending/failed logs and forced replication.

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

- No lost updates
- No write-write conflicts
- Logs ensure full durability
- Replication is batch-based and safe
- Recovery restores consistency
- Multi-master operation is conflict-free
- Automatic deadlock recovery
- Eventual consistency guaranteed
