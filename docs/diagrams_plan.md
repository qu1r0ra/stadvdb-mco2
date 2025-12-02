# Technical Report Diagrams Plan

Based on the project specifications, here is a comprehensive list of all diagrams needed for the technical report:

---

## Section 2: Distributed Database Design

### Diagram 2.1: System Architecture Overview
**Type**: Architecture Diagram (Mermaid Graph)
**Purpose**: Show the three-node distributed database setup
**Content**:
- Node 1 (Central) with full dataset
- Node 2 (Fragment 1) with partitioned data
- Node 3 (Fragment 2) with partitioned data
- Web application layer
- Client connections
- Network topology

### Diagram 2.2: Data Distribution & Fragmentation
**Type**: Entity/Data Diagram
**Purpose**: Illustrate how data is fragmented across nodes
**Content**:
- Visual representation of data partitioning logic
- Show sample records and which node they belong to
- Highlight the fragmentation criterion (courierName)
- Venn diagrams showing non-overlapping partitions

### Diagram 2.3: Replication Flow Overview
**Type**: Sequence Diagram (Mermaid)
**Purpose**: Show how data replicates between nodes in normal operation
**Content**:
- Write operation to Node 1
- Replication Log capture
- Async pull from Node 2/3
- Filter logic demonstration

---

## Section 3: Concurrency Control and Consistency

### Diagram 3.1: Update Strategy Algorithm
**Type**: Flowchart / Pseudocode Diagram
**Purpose**: Illustrate the update and replication algorithm
**Content**:
- Decision tree for write routing (Master vs Slave)
- Log capture process
- Replication polling mechanism
- Partition filtering logic
- NOT source code - should be algorithmic representation

### Diagram 3.2: Concurrency Test Case Setup
**Type**: Schematic/Test Setup Diagram
**Purpose**: Show the experimental setup for concurrent transactions
**Content**:
- Multiple client connections
- Concurrent transaction timelines (Gantt-style)
- Lock states at different points
- Isolation level configurations

### Diagram 3.3: Case #1 - Concurrent Reads
**Type**: Timeline/Sequence Diagram
**Purpose**: Visualize concurrent read transactions on the same data
**Content**:
- Transaction T1 and T2 timelines
- Read operations on shared data
- Lock behavior (or lack thereof)
- Different isolation level outcomes

### Diagram 3.4: Case #2 - Read + Write
**Type**: Timeline/Sequence Diagram
**Purpose**: Visualize one transaction reading while another writes
**Content**:
- Transaction T1 (read) and T2 (write) timelines
- Data version visibility
- Phantom/non-repeatable read scenarios
- Isolation level impact

### Diagram 3.5: Case #3 - Write + Write
**Type**: Timeline/Sequence Diagram
**Purpose**: Visualize concurrent write transactions
**Content**:
- Transaction T1 and T2 timelines (both writing)
- Lock acquisition and waiting
- Deadlock potential
- Commit/rollback outcomes

### Diagram 3.6: Test Results Table (Visual)
**Type**: Comparison Table/Matrix
**Purpose**: Present test results across isolation levels
**Content**:
- Rows: Test cases (1, 2, 3)
- Columns: Isolation levels (Read Uncommitted, Read Committed, Repeatable Read, Serializable)
- Cells: Success/Failure, Transaction throughput, Consistency outcome
- Color coding for quick interpretation

---

## Section 4: Global Failure Recovery

### Diagram 4.1: Recovery Strategy Algorithm
**Type**: Flowchart / Pseudocode Diagram
**Purpose**: Illustrate the recovery mechanism
**Content**:
- Failure detection logic
- Failover promotion process
- ID range assignment
- Catch-up sync process
- NOT source code - should be algorithmic representation

### Diagram 4.2: Node Failure Detection Flow
**Type**: State Diagram
**Purpose**: Show the health monitoring and failover trigger
**Content**:
- Normal state
- Health check routine
- Failure detection (3 consecutive failures)
- Failover state transition
- Recovery state transition

### Diagram 4.3: Case #1 - Node 2/3 → Central Failure
**Type**: Sequence Diagram
**Purpose**: Show replication failure when central node is down
**Content**:
- Transaction on Node 2/3
- Attempt to replicate to Node 1
- Connection timeout/error
- Log marked as failed/pending
- Retry mechanism

### Diagram 4.4: Case #2 - Central Node Recovery
**Type**: Sequence Diagram
**Purpose**: Show Node 1 coming back online and catching up
**Content**:
- Node 1 back online
- Detection of missed transactions
- Pull logs from Node 2/3
- Apply missed transactions
- System back to consistent state

### Diagram 4.5: Case #3 - Central → Node 2/3 Failure
**Type**: Sequence Diagram
**Purpose**: Show replication failure when slave node is down
**Content**:
- Transaction on Node 1
- Attempt to replicate to Node 2/3
- Connection timeout/error
- Log marked as pending
- Continue serving from Node 1

### Diagram 4.6: Case #4 - Slave Node Recovery
**Type**: Sequence Diagram
**Purpose**: Show Node 2/3 recovery and catch-up
**Content**:
- Node 2/3 back online
- Detection of missed transactions
- Pull logs from Node 1
- Apply missed transactions (with filtering)
- System back to consistent state

### Diagram 4.7: ID Range Partitioning
**Type**: Visual Chart/Timeline
**Purpose**: Show how ID ranges prevent collisions during failover
**Content**:
- Node 1: 1 - 999,999
- Node 2: 1,000,000 - 1,999,999
- Node 3: 2,000,000 - 2,999,999
- Example IDs generated during split-brain scenario

### Diagram 4.8: Recovery Test Results
**Type**: Table/Matrix
**Purpose**: Present recovery test results for all 4 cases
**Content**:
- Rows: Recovery cases (1, 2, 3, 4)
- Columns: Recovery time, Data consistency check, Success/Failure
- Visual indicators for pass/fail

---

## Section 5: Discussion (Optional Diagrams)

### Diagram 5.1: System Performance Comparison
**Type**: Bar Chart/Graph
**Purpose**: Compare throughput across isolation levels
**Content**:
- X-axis: Isolation levels
- Y-axis: Transactions per second
- Multiple bars for different test cases

### Diagram 5.2: Data Transparency Illustration
**Type**: Conceptual Diagram
**Purpose**: Show how users see a unified view despite fragmentation
**Content**:
- User perspective (single database)
- Backend reality (3 nodes with fragments)
- API abstraction layer

---

## Appendix (Optional)

### Diagram A.1: Database Schema ER Diagram
**Type**: Entity-Relationship Diagram
**Purpose**: Show the schema for Riders, Logs, ReplicationErrors tables
**Content**:
- Tables with columns
- Primary/Foreign keys
- Relationships

### Diagram A.2: Web Application Architecture
**Type**: Component Diagram
**Purpose**: Show the web application stack
**Content**:
- Frontend (EJS, CSS, JS)
- Backend (Node.js, Express)
- Middleware (Services, Routes)
- Database connections

---

## Summary of Diagrams

**Total Diagrams**: ~22

**By Section**:
- Section 2 (Distributed Database): 3 diagrams
- Section 3 (Concurrency): 6 diagrams
- Section 4 (Recovery): 8 diagrams
- Section 5 (Discussion): 2 diagrams (optional)
- Appendix: 3 diagrams (optional)

**By Type**:
- Architecture/System Diagrams: 3
- Sequence Diagrams: 7
- Flowcharts/Algorithms: 2
- Timeline/Gantt Diagrams: 3
- Tables/Matrices: 3
- State Diagrams: 1
- Charts/Graphs: 1
- ER Diagrams: 1
- Component Diagrams: 1

**Priority Levels**:
- **Critical** (Must Have): Diagrams 2.1, 2.3, 3.1, 3.6, 4.1, 4.2, 4.3-4.6, 4.8 (12 diagrams)
- **Important** (Should Have): Diagrams 2.2, 3.2-3.5, 4.7, 5.1 (6 diagrams)
- **Nice to Have**: Diagrams 5.2, A.1, A.2 (4 diagrams)
