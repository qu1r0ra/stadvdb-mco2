import { nodes } from "../config/db.js";
import { runTransaction } from "../utils/transactions.js";
import sleep from "../utils/sleep.js";

// Helper to log precise events
const logEvent = (logArray, start, actor, action, details) => {
    const elapsed = Date.now() - start;
    logArray.push({ time: `${elapsed}ms`, actor, action, details });
};

// Reset data helper
async function seedTestRider(pool, options) {
    if (!options) throw new Error("Missing test options (ID/Name)");

    const { id, firstName, lastName, courier, vehicle } = options;

    // FIX: Added 'createdAt' and 'updatedAt' with NOW() to satisfy schema
    const sql = `INSERT INTO Riders (id, firstName, lastName, courierName, vehicleType, age, gender, createdAt, updatedAt) 
                 VALUES (?, 'OriginalData', ?, ?, ?, 25, 'M', NOW(), NOW()) 
                 ON DUPLICATE KEY UPDATE firstName = 'OriginalData', age = 25, gender = 'M', updatedAt = NOW()`;

    await pool.query(sql, [id, lastName || 'Test', courier || 'JNT', vehicle || 'Motorcycle']);
}

// === TEST 1: READ - READ (Dirty Read Check) ===
export async function testConcurrentReads(isoLevel, options) {
    const pool = nodes.node1.pool;
    const logs = [];
    const startTime = Date.now();
    const targetId = options.id;
    const updateVal = options.firstName;

    await seedTestRider(pool, options);
    logEvent(logs, startTime, "System", "SETUP", `Reset ID ${targetId} to 'OriginalData'`);

    const t1 = runTransaction(pool, async (conn) => {
        logEvent(logs, startTime, "T1", "START", `Begin Tx (${isoLevel})`);

        await sleep(500);
        logEvent(logs, startTime, "T1", "UPDATE", `SET name = '${updateVal}' (Uncommitted)`);
        await conn.query("UPDATE Riders SET firstName = ? WHERE id = ?", [updateVal, targetId]);

        logEvent(logs, startTime, "T1", "WAIT", "Holding lock for 3s...");
        await sleep(3000);

        await conn.query("ROLLBACK");
        logEvent(logs, startTime, "T1", "ROLLBACK", "Reverted changes");
    }, "READ COMMITTED");

    const t2 = runTransaction(pool, async (conn) => {
        logEvent(logs, startTime, "T2", "START", `Begin Tx (${isoLevel})`);
        await sleep(1500);

        logEvent(logs, startTime, "T2", "SELECT", `Reading ID ${targetId}...`);
        const [rows] = await conn.query("SELECT firstName FROM Riders WHERE id = ?", [targetId]);
        const val = rows[0]?.firstName;

        logEvent(logs, startTime, "T2", "RESULT", `Read Value: '${val}'`);

        if (val === updateVal) {
            logEvent(logs, startTime, "ANALYSIS", "DIRTY READ", "FAIL: T2 saw uncommitted data.");
        } else {
            logEvent(logs, startTime, "ANALYSIS", "CLEAN READ", "SUCCESS: T2 saw committed data.");
        }
    }, isoLevel);

    await Promise.allSettled([t1, t2]);
    return logs.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));
}

// === TEST 2: READ - WRITE (Phantom Read Check) ===
export async function testReadWrite(isoLevel, options) {
    const pool = nodes.node1.pool;
    const logs = [];
    const startTime = Date.now();

    const t1 = runTransaction(pool, async (conn) => {
        logEvent(logs, startTime, "T1", "START", `Begin Tx (${isoLevel})`);

        const [r1] = await conn.query("SELECT count(*) as c FROM Riders");
        logEvent(logs, startTime, "T1", "SELECT 1", `Initial Count: ${r1[0].c}`);

        logEvent(logs, startTime, "T1", "WAIT", "Pausing 3s...");
        await sleep(3000);

        const [r2] = await conn.query("SELECT count(*) as c FROM Riders");
        logEvent(logs, startTime, "T1", "SELECT 2", `Final Count: ${r2[0].c}`);

        if (r1[0].c !== r2[0].c) {
            logEvent(logs, startTime, "ANALYSIS", "PHANTOM READ", `FAIL: Count changed (${r1[0].c} -> ${r2[0].c})`);
        } else {
            logEvent(logs, startTime, "ANALYSIS", "CONSISTENT", "SUCCESS: Count remained the same.");
        }
    }, isoLevel);

    const t2 = runTransaction(pool, async (conn) => {
        await sleep(1000);
        logEvent(logs, startTime, "T2", "START", "Begin Tx (READ COMMITTED)");

        logEvent(logs, startTime, "T2", "INSERT", "Adding new rider...");
        const startInsert = Date.now();

        // FIX: Added 'createdAt' and 'updatedAt' here as well
        await conn.query(
            "INSERT INTO Riders (firstName, lastName, courierName, vehicleType, age, gender, createdAt, updatedAt) VALUES (?, ?, ?, ?, 99, 'M', NOW(), NOW())",
            [options.firstName + " (Phantom)", options.lastName || 'PhantomLast', options.courier || 'JNT', options.vehicle || 'Motorcycle']
        );

        const duration = Date.now() - startInsert;
        if (duration > 1500) {
            logEvent(logs, startTime, "T2", "BLOCKED", `Insert took ${duration}ms (Blocked by T1?)`);
        } else {
            logEvent(logs, startTime, "T2", "SUCCESS", `Insert immediate (${duration}ms)`);
        }
    }, "READ COMMITTED");

    await Promise.allSettled([t1, t2]);
    return logs.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));
}

// === TEST 3: WRITE - WRITE (Lock Check) ===
export async function testWriteWrite(isoLevel, options) {
    const pool = nodes.node1.pool;
    const logs = [];
    const startTime = Date.now();
    const targetId = options.id;

    await seedTestRider(pool, options);
    logEvent(logs, startTime, "System", "SETUP", `Reset ID ${targetId}`);

    const t1 = runTransaction(pool, async (conn) => {
        logEvent(logs, startTime, "T1", "START", `Begin Tx (${isoLevel})`);

        logEvent(logs, startTime, "T1", "UPDATE", `Updating ID ${targetId}...`);
        await conn.query("UPDATE Riders SET age = 88 WHERE id = ?", [targetId]);

        logEvent(logs, startTime, "T1", "WAIT", "Holding Lock (3s)...");
        await sleep(3000);

        logEvent(logs, startTime, "T1", "COMMIT", "Transaction End");
    }, isoLevel);

    const t2 = runTransaction(pool, async (conn) => {
        await sleep(500);
        logEvent(logs, startTime, "T2", "START", "Begin Tx");

        logEvent(logs, startTime, "T2", "UPDATE", `Attempting update ID ${targetId}...`);
        const startReq = Date.now();

        try {
            await conn.query("UPDATE Riders SET age = 99 WHERE id = ?", [targetId]);
            const duration = Date.now() - startReq;

            if (duration > 1500) {
                logEvent(logs, startTime, "ANALYSIS", "LOCKED", `T2 waited ${duration}ms (Correct behavior)`);
            } else {
                logEvent(logs, startTime, "ANALYSIS", "NO LOCK", `T2 updated immediately (${duration}ms) - Overwrite?`);
            }
        } catch (e) {
            logEvent(logs, startTime, "T2", "ERROR", e.message);
        }
    }, isoLevel);

    await Promise.allSettled([t1, t2]);
    return logs.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));
}