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
