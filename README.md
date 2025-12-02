# stadvdb-mco2

A distributed database system for logistics rider management with concurrent multi-user access, horizontal fragmentation, and fault tolerance. Created for STADVDB (Advanced Database Systems).

![Year, Term, Course](https://img.shields.io/badge/AY2526--T1-STADVDB-blue)
![Node.js](https://img.shields.io/badge/Node.js-20.18.0-green) ![MySQL](https://img.shields.io/badge/MySQL-8.x-blue)

---

## Overview

This project implements a **3-node distributed database** for a logistics system managing rider profiles. The system features:

- **Horizontal Fragmentation**: Data partitioned by courier company (JNT vs Others)
- **Master-First Failover**: Automatic routing to fragment nodes when primary is unavailable
- **Manual Replication**: Pull-based synchronization triggered via API
- **Simulated Failures**: Test node crashes without infrastructure access
- **Concurrency Testing**: Built-in test cases for isolation level validation

---

## Features

- **Master-First Write Strategy** - Try Node 1 first, fallback to fragments on failure
- **Application-Level Logging** - Write-ahead logs for all INSERT/UPDATE/DELETE operations
- **Pull-Based Replication** - Manual sync between nodes with retry logic
- **Deadlock Auto-Retry** - Up to 3 attempts with exponential backoff
- **Simulated Node Failures** - Connection proxy for instant crash/recovery testing
- **Concurrency Test Suite** - Pre-built tests for Read-Read, Read-Write, Write-Write scenarios
- **EJS Dashboard** - Real-time 3-column view of all nodes

---

## Architecture

### Data Distribution

| Node | Contents | Fragmentation Rule |
|------|----------|-------------------|
| **Node 1 (Primary)** | All riders | Full dataset |
| **Node 2 (JNT Fragment)** | JNT riders only | `courierName = 'JNT'` |
| **Node 3 (Others Fragment)** | Non-JNT riders | `courierName IN ('LBCD', 'FEDEZ')` |

### ID Range Partitioning

To prevent primary key collisions during failover:

- **Node 1**: IDs 1 - 999,999 (normal operation)
- **Node 2**: IDs 1,000,000 - 1,999,999 (failover mode)
- **Node 3**: IDs 2,000,000 - 2,999,999 (failover mode)

See `ARCHITECTURE.md` for detailed technical design.

---

## Installation

### Prerequisites

- Node.js 20.18.0
- npm 10.8.2
- Access to 3 remote MySQL 8.x instances

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/qu1r0ra/stadvdb-mco2.git
   cd stadvdb-mco2
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   Duplicate `.env.example` and rename to `.env`:

   ```bash
   cp .env.example .env
   ```

   Fill in your database credentials:

   ```env
   # Node 1 (Primary)
   NODE1_HOST=your_host
   NODE1_PORT=3306
   NODE1_DB=ridersdb
   NODE1_USER=your_user
   NODE1_PASSWORD=your_password

   # Node 2 (JNT Fragment)
   NODE2_HOST=...
   # Node 3 (Others Fragment)
   NODE3_HOST=...
   ```

4. **Initialize databases**

   Run the schema on all 3 nodes:

   ```bash
   mysql -h NODE1_HOST -u USER -p < sql/schema.sql
   mysql -h NODE2_HOST -u USER -p < sql/schema.sql
   mysql -h NODE3_HOST -u USER -p < sql/schema.sql
   ```

   Set ID range offsets (see `sql/misc.sql`):

   ```sql
   -- On Node 2:
   ALTER TABLE Riders AUTO_INCREMENT = 1000000;
   -- On Node 3:
   ALTER TABLE Riders AUTO_INCREMENT = 2000000;
   ```

5. **Start the server**

   ```bash
   npm run dev
   ```

   Access the dashboard at `http://localhost:3000`

---

## Web Dashboard

The unified dashboard (accessible at `/`) provides:

### Node Status Monitoring
- Real-time display of ONLINE/OFFLINE status for all 3 nodes
- Visual indicators showing which node is currently accepting writes

### Failure Simulation
- **Kill/Revive Buttons**: Toggle node status to simulate crashes
- Instantly test failover behavior without touching infrastructure
- Demonstrates automatic routing to fragment nodes

### Rider Management
- **Add Rider**: Form auto-routes to correct node based on courier
- **Edit/Delete**: Update operations with fallback logic
- **3-Column View**: See how data distributes across nodes in real-time

### Concurrency Testing
- Run pre-defined test cases:
  - **Case 1**: Concurrent Reads (dirty read check)
  - **Case 2**: Read + Write (phantom read check)
  - **Case 3**: Write + Write (locking/serialization)
- Select isolation level: READ UNCOMMITTED / READ COMMITTED / REPEATABLE READ / SERIALIZABLE
- View detailed event logs showing transaction timelines

### Global Recovery
- **Manual Sync Trigger**: Run full bidirectional replication
- Recovery report showing logs applied and any errors

---

## API Endpoints

### Riders (CRUD)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/riders` | Fetch all riders (prefers Node 1, fallback to merge) |
| POST | `/api/riders` | Insert rider (tries Node 1 → fallback to fragment) |
| PUT | `/api/riders/:id` | Update rider by ID |
| DELETE | `/api/riders/:id` | Delete rider by ID |

**Example: Insert Rider**

```bash
curl -X POST http://localhost:3000/api/riders \
  -H "Content-Type: application/json" \
  -d '{
    "courierName": "JNT",
    "vehicleType": "Motorcycle",
    "firstName": "John",
    "lastName": "Doe",
    "gender": "M",
    "age": 30
  }'
```

### Recovery & Replication

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/recovery` | Full bidirectional sync (node1↔node2, node1↔node3) |
| POST | `/api/replication/replicate` | Sync specific pair: `{source, target}` |
| GET | `/api/replication/pending/:node` | List pending logs on a node |
| GET | `/api/replication/failed/:node` | List failed logs on a node |
| POST | `/api/replication/retry-failed` | Retry failed logs: `{source, target}` |

**Example: Trigger Full Recovery**

```bash
curl -X POST http://localhost:3000/api/recovery
```

**Example: Sync Specific Pair**

```bash
curl -X POST http://localhost:3000/api/replication/replicate \
  -H "Content-Type: application/json" \
  -d '{"source": "node2", "target": "node1"}'
```

### Simulation & Testing

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/test/node-status` | Get current status of all nodes |
| POST | `/api/test/node-status` | Toggle node status: `{node, status}` |
| POST | `/api/test/concurrency` | Run concurrency test: `{caseId, isolationLevel, ...}` |

**Example: Simulate Node 1 Failure**

```bash
curl -X POST http://localhost:3000/api/test/node-status \
  -H "Content-Type: application/json" \
  -d '{"node": "node1", "status": false}'
```

**Example: Run Concurrency Test**

```bash
curl -X POST http://localhost:3000/api/test/concurrency \
  -H "Content-Type: application/json" \
  -d '{
    "caseId": 1,
    "isolationLevel": "REPEATABLE READ",
    "id": 1,
    "firstName": "Modified"
  }'
```

---

## How It Works

### 1. Write Flow (Normal Operation)

```
User → POST /api/riders → ridersService.js
  ├─ Try Node 1 (Primary)
  │   ├─ BEGIN TRANSACTION
  │   ├─ INSERT INTO Riders
  │   ├─ INSERT INTO Logs (tx_id, action, new_value, status='pending')
  │   └─ COMMIT
  └─ Return {id, writtenTo: "node1"}
```

### 2. Write Flow (Node 1 Down)

```
User → POST /api/riders → ridersService.js
  ├─ Try Node 1 → Connection Error!
  └─ catch(err)
      ├─ Determine fragment: JNT → Node 2, Others → Node 3
      ├─ Write to Fragment (ID range 1M+ or 2M+)
      └─ Return {id, writtenTo: "node2", fallback: true}
```

### 3. Replication Flow (Manual Trigger)

```
Admin → POST /api/recovery → recoveryService.js
  ├─ Sync node1 ↔ node2
  │   ├─ GET pending logs from node1 (WHERE status='pending')
  │   ├─ Apply to node2 (filter: courierName='JNT')
  │   ├─ Mark replicated or failed
  │   └─ GET pending logs from node2
  │       └─ Apply to node1
  └─ Sync node1 ↔ node3 (same process)
```

---

## Testing

The system includes built-in concurrency tests to validate isolation levels:

### Test Cases

| Case | Scenario | What It Tests |
|------|----------|---------------|
| **1: Read-Read** | T1 UPDATE (rollback), T2 SELECT | Dirty reads |
| **2: Read-Write** | T1 SELECT count, T2 INSERT | Phantom reads |
| **3: Write-Write** | T1 UPDATE, T2 UPDATE (same row) | Locking/serialization |

### Running Tests via Dashboard

1. Navigate to dashboard (`http://localhost:3000`)
2. Scroll to "Concurrency Testing" section
3. Select test case (1, 2, or 3)
4. Choose isolation level
5. Fill in test parameters (ID, values)
6. Click "Run Test"
7. View detailed event log with timestamps

### Running Tests via API

```bash
# Case 1: Dirty Read Test
curl -X POST http://localhost:3000/api/test/concurrency \
  -H "Content-Type: application/json" \
  -d '{
    "caseId": 1,
    "isolationLevel": "READ UNCOMMITTED",
    "id": 1,
    "firstName": "DirtyValue"
  }'
```

---

## Troubleshooting

### Connection refused errors

**Problem**: `Connection refused: node1 is offline (Simulated)`

**Solution**: Check if you "killed" the node via dashboard. Revive it:

```bash
curl -X POST http://localhost:3000/api/test/node-status \
  -d '{"node": "node1", "status": true}'
```

### Replication not happening

**Problem**: New records in Node 1 not appearing in Node 2/3

**Solution**: Replication is **manual**. Trigger sync:

```bash
curl -X POST http://localhost:3000/api/recovery
```

### ID conflicts after failover

**Problem**: Cannot insert rider, `Duplicate entry for key 'PRIMARY'`

**Solution**: Ensure ID range offsets are configured on Node 2 and Node 3:

```sql
ALTER TABLE Riders AUTO_INCREMENT = 1000000;  -- Node 2
ALTER TABLE Riders AUTO_INCREMENT = 2000000;  -- Node 3
```

---

## Project Structure

```
stadvdb-mco2/
├── src/
│   ├── config/db.js          # Connection pools + simulation proxy
│   ├── routes/               # API endpoints
│   ├── services/             # Business logic (riders, recovery, simulation)
│   ├── utils/                # Transaction wrapper, logging, helpers
│   └── server.js             # Express app entry point
├── views/
│   └── dashboard.ejs         # Main UI template
├── public/
│   └── style.css             # Dashboard styles
├── sql/
│   ├── schema.sql            # Database schema
│   └── misc.sql              # ID range configuration
├── .env.example              # Environment template
├── package.json              # Dependencies
└── README.md                 # This file
```

---

## Contributing

This is a course project for STADVDB. Contributions are not expected, but feel free to fork for educational purposes.

---

## License

ISC

---

## Authors

STADVDB MCO2 Team
De La Salle University
AY 2024-2025 Term 1

---

**Documentation**: See `ARCHITECTURE.md` for detailed technical design and `DESIGN_DECISIONS.md` for rationale behind key choices.
