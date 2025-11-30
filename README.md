# stadvdb-mco2 <!-- omit from toc -->

<!-- ![title](./readme/title.jpg) -->

<!-- Refer to https://shields.io/badges for usage -->

![Year, Term, Course](https://img.shields.io/badge/AY2526--T1-STADVDB-blue)

![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=fff) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=000) ![MySQL](https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=fff)

A web application that connects to a distributed database system which supports concurrent multi-user access. Created for STADVDB (Advanced Database Systems).

---

## Overview

This project implements a **master-slave distributed database system** with:

- **Master-slave replication** with automatic failover
- **Concurrency-safe writes** with REPEATABLE READ isolation and deadlock handling
- **Automatic health monitoring** and failure detection (5-second intervals)
- **Partition-aware failover** (JNT vs. non-JNT couriers during Node 1 failure)
- **Application-level write-ahead logging** for durability and replication
- **Eventually consistent recovery** with catch-up synchronization

Backend uses **Node.js v20.18.0+** and **Express**.
Data is distributed across **three remote MySQL 8.0 VM nodes**.

### Key Design Principles

1. **Master-Slave Simplicity**: Node 1 handles all writes during normal operation
2. **Automatic Failover**: Node 2/3 promoted to masters when Node 1 fails
3. **Partition-Aware**: Failover maintains JNT/non-JNT separation
4. **Unidirectional Replication**: Master → slaves during normal operation
5. **Automatic Recovery**: Node 1 catches up from slaves when returning

---

## Features

### Core Functionality

- **Write-ahead logging** on all INSERT/UPDATE/DELETE operations
- **Master-slave replication** (Node 1 → Node 2/3 during normal operation)
- **Automatic failover** (Node 2/3 promoted when Node 1 fails)
- **Health monitoring** (5-second intervals, 3-strike failure detection)
- **Deadlock-tolerant transactions** (2 retries, exponential backoff)
- **Batch replication** (100 logs per batch for efficiency)
- **Partition-aware failover** (JNT → Node 2, others → Node 3)
- **Automatic recovery** (Node 1 catches up from slaves)
- **Admin utilities** for manual failover control

### Advanced Capabilities

- 🔒 **REPEATABLE READ isolation** enforced per transaction
- 🔄 **Idempotent replication** (safe to replay operations)
- ⚡ **Automatic promotion/demotion** (slaves become masters during failover)
- 📊 **Observable failures** (failed logs tracked in ReplicationErrors table)
- 🚀 **High availability** (partial write availability during Node 1 failure)

---

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for comprehensive details.

### System Components

- **`/services`** — Business logic (CRUD operations, replication, recovery)
- **`/routes`** — Express API endpoints (riders, recovery, replication admin)
- **`/utils`** — Transaction manager, logging utilities, helper functions
- **`/scripts`** — Database initialization and test suite
- **`/sql`** — Schema definitions, triggers (deprecated), misc utilities

### Data Flow

```
Client Request
    ↓
Express Router (/api/riders, /api/recovery, /api/replication)
    ↓
Service Layer (ridersService, recoveryService)
    ↓
Transaction Manager (runTransaction with deadlock handling)
    ↓
MySQL Pool (Node 1, Node 2, or Node 3)
    ↓
Write-Ahead Log (atomic with main write)
    ↓
Replication (pull-based, batch-driven, partition-filtered)
```

---

## Installation

1. Clone the repository

   ```bash
   git clone https://github.com/qu1r0ra/stadvdb-mco2.git
   cd stadvdb-mco2
   ```

2. Install dependencies

   ```bash
   npm install
   ```

3. Configure environment

   Duplicate `.env.example` and rename it to `.env`

   ```bash
   cp .env.example .env
   ```

   Replace fields with `(replace)`

---

## API Endpoints

### Riders

| Method | Route           | Description        |
| ------ | --------------- | ------------------ |
| GET    | /api/riders     | Fetch all riders   |
| POST   | /api/riders     | Insert a new rider |
| PUT    | /api/riders/:id | Update a rider     |
| DELETE | /api/riders/:id | Delete a rider     |

### Recovery

| Method | Route                | Description         |
| ------ | -------------------- | ------------------- |
| POST   | /api/recovery        | Full recovery       |
| GET    | /api/recovery/status | Check system health |

### Replication Admin

| Method | Route                          | Description       |
| ------ | ------------------------------ | ----------------- |
| GET    | /api/replication/pending/:node | List pending logs |
| GET    | /api/replication/failed/:node  | List failed logs  |
| POST   | /api/replication/retry-failed  | Retry failures    |
| POST   | /api/replication/replicate     | Force sync pair   |
