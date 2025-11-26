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

Replication occurs only between:

- node1 ↔ node2
- node1 ↔ node3

Bidirectional, batch-based (100 logs).

### 4.2 Conflict-Free Design

Partition rules prevent conflicts:

- Node2 handles JNT exclusively
- Node3 handles others exclusively
- Node1 aggregates but does not originate partition-specific writes

No rider can be modified by two writer nodes.

### 4.3 Replication Process

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

- Node1 acts as central read node
- Node2/3 fragment writers

### 6.2 Node1 Failure

- Node2 and Node3 continue serving reads + writes
- Their logs sync back when Node1 returns

### 6.3 Safety Guarantee

No conflicting writes due to partition rules.

---

## 7. API Overview

### `/riders`

- Write routed to correct fragment based on courier
- Reads prefer Node1, fallback to Node2+Node3 merge

### `/recovery`

Runs full synchronization.

### `/replication`

Admin tools for pending/failed logs and forced replication.

---

## 8. Summary of Guarantees

- No lost updates
- No write-write conflicts
- Logs ensure full durability
- Replication is batch-based and safe
- Recovery restores consistency
- Multi-master operation is conflict-free
- Automatic deadlock recovery
- Eventual consistency guaranteed
