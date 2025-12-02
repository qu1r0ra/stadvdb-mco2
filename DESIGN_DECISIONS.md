# DESIGN_DECISIONS.md <!-- omit from toc -->

This document explains the _why_ behind every architectural decision in the STADVDB MCO2 project. It serves as a deep reference for the concurrency, replication, recovery, and simulation design of the distributed database system.

**Purpose**: Technical reference for project documentation and team understanding.

---

## Table of Contents <!-- omit from toc -->

- [1. Concurrency Design](#1-concurrency-design)
  - [1.1. Isolation Level: REPEATABLE READ](#11-isolation-level-repeatable-read)
  - [1.2. Deadlock Policy](#12-deadlock-policy)
  - [1.3. Transaction Wrapper](#13-transaction-wrapper)
  - [1.4. No Explicit SQL Locks](#14-no-explicit-sql-locks)
- [2. Replication Design](#2-replication-design)
  - [2.1. Master-First with Fallback Architecture](#21-master-first-with-fallback-architecture)
  - [2.2. Partition-Based Filtering](#22-partition-based-filtering)
  - [2.3. On-Demand Replication](#23-on-demand-replication)
  - [2.4. ID Range Partitioning](#24-id-range-partitioning)
- [3. Recovery Design](#3-recovery-design)
  - [3.1. Simulated Failover via Connection Proxy](#31-simulated-failover-via-connection-proxy)
  - [3.2. Pairwise Synchronization](#32-pairwise-synchronization)
  - [3.3. Idempotent Reapplication](#33-idempotent-reapplication)
- [4. Simulation Architecture](#4-simulation-architecture)
  - [4.1. Connection Proxy for Failure Simulation](#41-connection-proxy-for-failure-simulation)
  - [4.2. Deterministic Concurrency Testing](#42-deterministic-concurrency-testing)
- [5. Frontend Architecture](#5-frontend-architecture)
  - [5.1. Server-Side Rendering (EJS)](#51-server-side-rendering-ejs)
  - [5.2. Unified Dashboard](#52-unified-dashboard)

---

## 1. Concurrency Design

### 1.1. Isolation Level: REPEATABLE READ

We enforce **REPEATABLE READ per transaction** across all nodes.

- **Why**: Standard MySQL default. It prevents dirty reads and non-repeatable reads, which is critical for a financial/logistics system where data consistency is paramount.
- **Trade-off**: Higher risk of deadlocks compared to READ COMMITTED, but we handle this via our retry logic.

### 1.2. Deadlock Policy

**Decision**: Automatic retry with exponential backoff.

- **Mechanism**: If a transaction fails with `ER_LOCK_DEADLOCK` (MySQL 1213), we retry up to 2 times.
- **Why**: Distributed systems often have transient locking issues. Failing immediately is poor UX. Retrying solves >90% of deadlock cases without user intervention.

### 1.3. Transaction Wrapper

**Decision**: All database writes must go through `runTransaction()`.

- **Why**: Centralizes error handling, commit/rollback logic, and deadlock retries. It ensures no developer "forgets" to release a connection or handle an error.

### 1.4. No Explicit SQL Locks

**Decision**: We do **not** use `LOCK TABLES` or `SELECT ... FOR UPDATE` manually.

- **Why**: We rely on InnoDB's row-level locking. Explicit locks reduce concurrency and increase deadlock risk.

---

## 2. Replication Design

### 2.1. Master-First with Fallback Architecture

**Decision**: Node 1 is the **primary write target**. Node 2 and Node 3 are **fragments** that can accept writes during failover.

- **Normal Operation**: All writes **try Node 1 first** using try-catch logic. If Node 1 is unreachable, the write falls back to the appropriate fragment (Node 2 for JNT, Node 3 for others).
- **Implementation**: `ridersService.js` wraps Node 1 writes in try-catch blocks. On connection errors, it immediately routes to the fragment based on `courierName`.
- **Why**: Simplifies failover logic—no complex health monitoring required. The database connection failure itself triggers the fallback.

### 2.2. Partition-Based Filtering

**Decision**: Replication is filtered by courier type.

- **Node 1 -> Node 2**: Only replicates `JNT` riders.
- **Node 1 -> Node 3**: Only replicates non-`JNT` riders.
- **Why**: Implements the fragmentation requirement. Node 2 and Node 3 only hold their specific subset of data, while Node 1 holds the global view.

### 2.3. On-Demand Replication

**Decision**: Replication is **manually triggered** via API endpoints, not automatic polling.

- **Endpoints**:
  - `POST /api/replication/replicate` - Trigger replication between specific nodes
  - `POST /api/recovery` - Run full bidirectional synchronization
- **Why**:
  - **Explicit Control**: Tests and admins can trigger replication exactly when needed.
  - **Resource Efficiency**: No background polling consuming connections/CPU.
  - **Debugging**: Easier to trace replication flow when it's explicit.

### 2.4. ID Range Partitioning

**Decision**: Each node uses a distinct `AUTO_INCREMENT` range.
- Node 1: 1 - 999,999
- Node 2: 1,000,000 - 1,999,999
- Node 3: 2,000,000 - 2,999,999

- **Why**: Prevents ID collisions during failover. If Node 2 and Node 3 both insert records while Node 1 is down, they would otherwise generate duplicate IDs (e.g., both create ID 105). Range partitioning guarantees global uniqueness without distributed coordination (like UUIDs or Zookeeper).

---

## 3. Recovery Design

### 3.1. Simulated Failover via Connection Proxy

**Decision**: Node failure is simulated by toggling a `nodeStatus` flag, not by real health checks.

- **Mechanism**:
  - `src/config/db.js` wraps connection pools with a Proxy.
  - Before every query, it checks `nodeStatus[nodeX]`.
  - If `false`, it throws a `Connection refused` error.
- **Triggering**: `POST /api/test/node-status` with `{node: "node1", status: false}` simulates a crash.
- **Why**: Allows instant, deterministic failure testing without killing actual processes. Perfect for demonstrating recovery in controlled environments (exams, presentations).

### 3.2. Pairwise Synchronization

**Decision**: Recovery is just "mutual replication".

- **Why**: When Node 1 comes back, it simply "pulls" from Node 2 and Node 3. There is no special "recovery mode" code—it's just the standard replication logic running in reverse. This reduces code complexity significantly.

### 3.3. Idempotent Reapplication

**Decision**: All log applications use `REPLACE INTO` or check existence.

- **Why**: If a log is applied twice (e.g., network timeout during ack), it shouldn't corrupt data. Idempotency ensures safety during network instability.

---

## 4. Simulation Architecture

### 4.1. Connection Proxy for Failure Simulation

**Decision**: Wrap MySQL connection pools with a JS `Proxy` object.

- **Why**: We needed a way to simulate "Node 1 is down" without actually killing the Docker container or MySQL process.
- **Mechanism**: The Proxy intercepts `pool.query()`. If the global state says `node1: false`, it throws a `CONNECTION_REFUSED` error immediately.
- **Benefit**: Allows deterministic, instant "crashing" and "reviving" of nodes via API for testing.

### 4.2. Deterministic Concurrency Testing

**Decision**: Use `sleep()` injection in test transactions.

- **Why**: Real race conditions are hard to reproduce reliably. By injecting `await sleep(2000)` inside transactions, we force them to overlap, guaranteeing that locking/isolation behavior is exercised.

---

## 5. Frontend Architecture

### 5.1. Server-Side Rendering (EJS)

**Decision**: Use EJS (Embedded JavaScript) for the dashboard.

- **Why**:
  - **Simplicity**: No build step (Webpack/Vite) required.
  - **Direct Data Access**: The Node.js server already has the data; rendering it directly is faster than building a separate React/Vue SPA API.
  - **Project Scope**: Fits the "Distributed Database" focus better than a complex frontend framework.

### 5.2. Unified Dashboard

**Decision**: Show all 3 nodes side-by-side.

- **Why**: Provides immediate visual confirmation of replication and fragmentation. Users can see a record appear in Node 1 and then propagate (or fail to propagate) to Node 2/3 in real-time.

---

**Document Version**: 3.0
**Last Updated**: 2025-12-01
**Authors**: STADVDB MCO2 Team
