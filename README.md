# stadvdb-mco2 <!-- omit from toc -->

<!-- ![title](./readme/title.jpg) -->

<!-- Refer to https://shields.io/badges for usage -->

![Year, Term, Course](https://img.shields.io/badge/AY2526--T1-STADVDB-blue)

![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=fff) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=000) ![MySQL](https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=fff)

A web application that connects to a distributed database system which supports concurrent multi-user access. Created for STADVDB (Advanced Database Systems).

---

## Overview

This project implements a **distributed database system** with:

- Fragmented storage
- Concurrency-safe writes
- Bidirectional replication
- Automatic recovery
- Application-level write-ahead logging

Backend uses **Node.js** and **Express**.
Data is distributed across three remote VM nodes.

---

## Features

- Write-ahead logs on all write operations
- Fragment-aware routing
- Deadlock-tolerant transactions
- Batch replication (100 logs)
- Full recovery with consistent catch-up
- Node1 read prioritization with fallback
- Admin utilities for failed logs

---

## Architecture

See `ARCHITECTURE.md`.

Main components:

- `/services` — CRUD and replication logic
- `/routes` — Express API endpoints
- `/utils` — transaction manager, logging, sleep helper
- `/scripts/db` — dataset loader

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

### Web Dashboard

A comprehensive web interface is available at `http://localhost:3000` (default) to visualize and control the system.

**Features:**
- **Node Status Monitoring**: Real-time status of Node 1 (Master), Node 2 (JNT), and Node 3 (Others).
- **Failure Simulation**: Toggle nodes ONLINE/OFFLINE to simulate crashes and network partitions.
- **Concurrency Testing**: Run pre-defined transaction scenarios (Read-Read, Read-Write, Write-Write) with configurable Isolation Levels.
- **Rider Management**: CRUD operations with automatic routing to the correct node.
- **Global Recovery**: Trigger system-wide recovery and synchronization.

### API Endpoints

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
| GET    | /api/replication/failover-status | Check failover status |
| POST   | /api/replication/promote       | Manual failover (promote slaves) |
| POST   | /api/replication/demote        | Manual recovery (demote slaves) |
| POST   | /api/replication/cleanup       | Clear all tables and reset ID offsets (testing) |
| GET    | /api/replication/consistency-check | Verify data consistency across nodes |

### Simulation & Testing

| Method | Route                  | Description |
| ------ | ---------------------- | ----------- |
| GET    | /api/test/node-status  | Get status of all nodes |
| POST   | /api/test/node-status  | Toggle node status (Kill/Revive) |
| POST   | /api/test/concurrency  | Run concurrency test cases |

---

## ID Range Partitioning

To prevent auto-increment ID collisions during failover, each node uses a distinct ID range:

- **Node 1**: 1 - 999,999 (normal operation)
- **Node 2**: 1,000,000 - 1,999,999 (failover mode only)
- **Node 3**: 2,000,000 - 2,999,999 (failover mode only)

This ensures globally unique IDs even when nodes operate independently during network partitions.
