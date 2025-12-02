# Project Architecture

## 1. System Overview

This system implements a **distributed database for logistics rider management** with:

- **3-Node Architecture**: 1 primary node (Node 1) + 2 fragment nodes (Node 2, Node 3)
- **Horizontal Fragmentation**: Data partitioned by `courierName` (JNT vs Others)
- **Master-First Failover Strategy**: Try Node 1 first, fallback to appropriate fragment on failure
- **Application-Level Replication**: Write-ahead logging with manual pull-based synchronization
- **Simulated Failure Testing**: Connection proxy allows instant node "crash" simulation
- **Concurrency Control**: REPEATABLE READ isolation with automatic deadlock retry

---

## 2. Technology Stack

- **Backend**: Node.js 20.18.0 + Express 5.1.0
- **Database**: MySQL 8.x (3 remote instances)
- **Frontend**: Server-side rendering with EJS templates
- **Key Libraries**:
  - `mysql2` - Database driver with promise support
  - `uuid` - Transaction ID generation
  - `dotenv` - Environment configuration
  - `body-parser` - JSON request parsing

---

## 3. System Components

### 3.1 Directory Structure

```
/src
├── /config
│   └── db.js                 # Connection pools + failure simulation proxy
├── /routes
│   ├── riders.js             # CRUD endpoints for rider management
│   ├── recovery.js           # Manual recovery trigger
│   ├── replication.js        # Replication admin endpoints
│   └── testRouter.js         # Simulation controls (node status, concurrency tests)
├── /services
│   ├── ridersService.js      # Business logic with try-catch fallback
│   ├── recoveryService.js    # Pull-based replication + retry logic
│   └── simulationService.js  # Concurrency test cases (1-3)
├── /utils
│   ├── transactions.js       # Transaction wrapper with deadlock retry
│   ├── applyLog.js           # Idempotent log application logic
│   ├── logger.js             # Logging utilities
│   └── sleep.js              # Async delay helper
└── server.js                 # Express app entry point

/views
└── dashboard.ejs             # Main UI template (3-column node display)

/public
└── style.css                 # Dashboard CSS

/sql
├── schema.sql                # Database schema (Riders, Logs, ReplicationErrors)
└── misc.sql                  # ID range offset configuration
```

---

## 4. Database Architecture

### 4.1 Schema

```sql
-- Riders: Main data table (identical on all 3 nodes)
CREATE TABLE Riders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  courierName ENUM('JNT', 'LBCD', 'FEDEZ'),
  vehicleType ENUM('Motorcycle', 'Bicycle', 'Tricycle', 'Car'),
  firstName VARCHAR(50),
  lastName VARCHAR(50),
  gender VARCHAR(10),
  age INT,
  createdAt DATETIME,
  updatedAt DATETIME
);

-- Logs: Application-level write-ahead log
CREATE TABLE Logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tx_id VARCHAR(50),
  node_name ENUM('node1','node2','node3'),
  action ENUM('INSERT','UPDATE','DELETE'),
  rider_id INT,
  old_value JSON,
  new_value JSON,
  status ENUM('pending','replicated','failed'),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ReplicationErrors: Diagnostic table for failed replication
CREATE TABLE ReplicationErrors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  log_id INT,
  source_node ENUM('node1','node2','node3'),
  target_node ENUM('node1','node3','node3'),
  attempts INT,
  last_error TEXT,
  last_error_time DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2 Data Distribution

| Node | Contents | Fragmentation Rule |
|------|----------|-------------------|
| **Node 1** | All riders | None (full dataset) |
| **Node 2** | JNT riders only | `WHERE courierName = 'JNT'` |
| **Node 3** | All other riders | `WHERE courierName IN ('LBCD', 'FEDEZ')` |

### 4.3 ID Range Partitioning

To prevent primary key collisions during failover:

- **Node 1**: AUTO_INCREMENT starts at 1 (range: 1 - 999,999)
- **Node 2**: AUTO_INCREMENT starts at 1,000,000 (range: 1M - 1.999M)
- **Node 3**: AUTO_INCREMENT starts at 2,000,000 (range: 2M - 2.999M)

Configured via `ALTER TABLE Riders AUTO_INCREMENT = [offset];`

---

## 5. Write Strategy (Master-First with Fallback)

### 5.1 Normal Operation Flow

1. **Client sends write request** (INSERT/UPDATE/DELETE)
2. **ridersService.js tries Node 1** inside `try { }` block:
   - BEGIN TRANSACTION
   - Execute SQL operation
   - INSERT log entry into `Logs` table
   - COMMIT
3. **On success**: Return `{id, txId, writtenTo: "node1"}`
4. **On failure** (`catch` block):
   - Determine fragment: JNT → Node 2, Others → Node 3
   - Retry write on fragment with ID range offset
   - Return `{id, txId, writtenTo: "node2|node3", fallback: true}`

### 5.2 Implementation (ridersService.js)

```javascript
export async function insertRider(data) {
  const fragment = getFragment(data.courierName);  // JNT → node2, else → node3

  try {
    return await runTransaction(nodes.node1.pool, async (conn) => {
      // Write to Node 1 + create log
    });
  } catch (err) {
    // FALLBACK to fragment
    return await runTransaction(fragment.pool, async (conn) => {
      // Write to Node 2/3 + create log
    });
  }
}
```

---

## 6. Replication Architecture

### 6.1 Pull-Based Manual Replication

Replication is **not automatic**. It must be manually triggered via API:

- `POST /api/replication/replicate` - Sync specific pair (source/target)
- `POST /api/recovery` - Full bidirectional sync (node1↔node2, node1↔node3)

### 6.2 Replication Process (recoveryService.js)

```
1. GET pending logs from source node (status = 'pending')
2. For each log:
   a. Try to apply log to target (up to 3 attempts with exponential backoff)
   b. On success: UPDATE Logs SET status='replicated'
   c. On failure: UPDATE Logs SET status='failed' + INSERT ReplicationErrors
3. Process in batches of 100 logs
4. Return summary report
```

### 6.3 Partition Filtering

When replicating from Node 1 to Node 2/3:
- **Node 2**: Only apply logs where `courierName = 'JNT'`
- **Node 3**: Only apply logs where `courierName != 'JNT'`

Filtering happens in `applyLogToNode()` logic (not shown in simplified schema).

### 6.4 Idempotent Log Application

- **INSERT**: Uses `REPLACE INTO` (safe for re-application)
- **UPDATE**: Applies full JSON snapshot
- **DELETE**: Removes by `id`

All operations are safe to retry!

---

## 7. Failure Simulation Architecture

### 7.1 Connection Proxy (db.js)

Instead of actually killing database servers, we **wrap connection pools** with a Proxy:

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

### 7.2 Simulation Endpoints

| Method | Route | Body | Effect |
|--------|-------|------|--------|
| POST | /api/test/node-status | `{node: "node1", status: false}` | "Kill" Node 1 |
| POST | /api/test/node-status | `{node: "node1", status: true}` | "Revive" Node 1 |
| GET | /api/test/node-status | - | Get current status |

When `nodeStatus.node1 = false`:
- All queries to Node 1 throw `Connection refused` error
- `ridersService.js` catches error → routes to fragment
- Perfect for demonstrating failover without infrastructure access!

---

## 8. Concurrency Control

### 8.1 Isolation Level

All transactions run under **REPEATABLE READ**:
```javascript
await conn.query(`SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
```

### 8.2 Deadlock Retry (transactions.js)

```javascript
export async function runTransaction(pool, cb, isoLevel = "REPEATABLE READ", maxAttempts = 3) {
  while (attempt < maxAttempts) {
    try {
      // BEGIN, execute cb, COMMIT
    } catch (err) {
      if (err.errno === 1213 || err.errno === 1205) {  // Deadlock or Lock Wait
        await sleep(100 * Math.pow(2, attempt));  // Exponential backoff
        continue;
      }
      throw err;
    }
  }
}
```

### 8.3 Concurrency Testing (simulationService.js)

Three test cases implemented:

| Case | Description | Purpose |
|------|-------------|---------|
| **Case 1: Read-Read** | Two concurrent SELECT queries | Test dirty read isolation |
| **Case 2: Read-Write** | One SELECT + one INSERT (concurrent) | Test phantom reads |
| **Case 3: Write-Write** | Two concurrent UPDATEs on same row | Test locking/serialization |

Tests use `sleep()` to force transaction overlap and log precise event timings.

Triggered via: `POST /api/test/concurrency`

---

## 9. Frontend Architecture

### 9.1 Server-Side Rendering

- **Template Engine**: EJS
- **Entry Point**: `server.js` → `GET /` route
- **Data Fetching**: Parallel calls to all 3 nodes
- **Rendering**: Single dashboard view with 3-column layout

```javascript
app.get("/", async (req, res) => {
  const [node1Data, node2Data, node3Data] = await Promise.all([
    getRidersFromNode("node1"),
    getRidersFromNode("node2"),
    getRidersFromNode("node3")
  ]);

  res.render("dashboard", { node1, node2, node3 });
});
```

### 9.2 Dashboard Features

- **Node Status Panels**: Real-time ONLINE/OFFLINE display
- **Kill/Revive Buttons**: Simulate node failures
- **Rider CRUD**: Add/Edit/Delete forms with auto-routing
- **Concurrency Tests**: Run Case 1/2/3 with configurable isolation levels
- **Global Recovery**: Manual trigger for full system sync

---

## 10. API Reference

### Riders (CRUD)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/riders | Fetch all riders |
| POST | /api/riders | Insert rider (tries Node 1 → fallback) |
| PUT | /api/riders/:id | Update rider |
| DELETE | /api/riders/:id | Delete rider |

### Recovery & Replication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/recovery | Full bidirectional sync (node1↔node2, node1↔node3) |
| POST | /api/replication/replicate | Sync specific pair: `{source, target}` |
| GET | /api/replication/pending/:node | List pending logs |
| GET | /api/replication/failed/:node | List failed logs |
| POST | /api/replication/retry-failed | Retry failed logs: `{source, target}` |

### Testing & Simulation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/test/node-status | Get current node status |
| POST | /api/test/node-status | Toggle status: `{node, status}` |
| POST | /api/test/concurrency | Run test: `{caseId, isolationLevel, ...options}` |

---

## 11. Key Design Decisions

### Why Master-First with Try-Catch?

- **Simplicity**: No separate health monitoring service needed
- **Deterministic**: Connection errors directly trigger fallback
- **Fast**: Immediate routing decision based on exception

### Why Manual Replication?

- **Explicit Control**: Admins/tests trigger sync exactly when needed
- **Resource Efficiency**: No background polling consuming connections/CPU
- **Debugging**: Easier to trace and test replication flow

### Why Simulated Failures?

- **Portability**: Works without infrastructure access (perfect for demos/exams)
- **Deterministic**: Instant failure/recovery without timing issues
- **Safe**: No risk of corrupting real database state

---

## 12. Guarantees

- - **No Lost Updates**: ACID transactions ensure durability
- - **No Write Conflicts**: Partition rules prevent concurrent writes to same record
- - **Idempotent Replication**: Logs can be applied multiple times safely
- - **Automatic Deadlock Recovery**: Up to 3 retries with exponential backoff
- - **Eventually Consistent**: Manual sync restores consistency after failures

---

**Document Version**: 4.0 (Complete Rewrite)
**Last Updated**: 2025-12-02
**Authors**: STADVDB MCO2 Team
