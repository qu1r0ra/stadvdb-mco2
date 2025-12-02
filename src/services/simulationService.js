import { nodes } from "../config/db.js";
import { runTransaction } from "../utils/transactions.js";
import sleep from "../utils/sleep.js";

// Helper to reset data before test
async function seedTestRider(pool, options) {
    const { id, firstName, lastName, courier, vehicle } = options;
    const sql = `INSERT INTO Riders (id, firstName, lastName, courierName, vehicleType, age) 
                 VALUES (?, 'Original', ?, ?, ?, 25) 
                 ON DUPLICATE KEY UPDATE firstName = 'Original', age = 25`;
    await pool.query(sql, [id, lastName, courier, vehicle]);
}

// === TEST 1: READ - READ ===
// (Technically Dirty Read check: Can T2 read what T1 is writing?)
export async function testConcurrentReads(isoLevel, options) {
    const pool = nodes.node1.pool;
    const report = [];
    const targetId = options.id;
    const newName = options.firstName;

    await seedTestRider(pool, options);

    const t1 = runTransaction(pool, async (conn) => {
        report.push(`[T1] Updating ID ${targetId} to '${newName}' (Uncommitted)...`);
        await conn.query("UPDATE Riders SET firstName = ? WHERE id = ?", [newName, targetId]);
        await sleep(3000);
        report.push(`[T1] Committing change.`);
    }, "READ COMMITTED");

    const t2 = runTransaction(pool, async (conn) => {
        await sleep(1000);
        const [rows] = await conn.query("SELECT firstName FROM Riders WHERE id = ?", [targetId]);
        const val = rows[0]?.firstName;

        if (val === newName) {
            report.push(`[RESULT] DIRTY READ: Saw uncommitted data '${val}'`);
        } else {
            report.push(`[RESULT] CLEAN READ: Saw committed data '${val}'`);
        }
    }, isoLevel);

    await Promise.allSettled([t1, t2]);
    return report;
}

// === TEST 2: READ - WRITE ===
// (Phantom Read check: T1 Reads, T2 Writes, T1 Reads again)
export async function testReadWrite(isoLevel, options) {
    const pool = nodes.node1.pool;
    const report = [];

    const t1 = runTransaction(pool, async (conn) => {
        const [r1] = await conn.query("SELECT count(*) as c FROM Riders");
        report.push(`[T1] Initial Count: ${r1[0].c}`);
        await sleep(3000);
        const [r2] = await conn.query("SELECT count(*) as c FROM Riders");

        if (r1[0].c !== r2[0].c) {
            report.push(`[RESULT] PHANTOM: Count changed (${r1[0].c} -> ${r2[0].c})`);
        } else {
            report.push(`[RESULT] CONSISTENT: Count stayed ${r1[0].c}`);
        }
    }, isoLevel);

    const t2 = runTransaction(pool, async (conn) => {
        await sleep(500);
        report.push(`[T2] Inserting new rider...`);
        const start = Date.now();
        await conn.query("INSERT INTO Riders (firstName, lastName, courierName, vehicleType, age) VALUES (?, ?, ?, ?, 99)",
            [options.firstName + " (Phantom)", options.lastName, options.courier, options.vehicle]);

        if (Date.now() - start > 1500) {
            report.push(`[RESULT] T2 BLOCKED by T1 Lock`);
        }
    }, "READ COMMITTED");

    await Promise.allSettled([t1, t2]);
    return report;
}

// === TEST 3: WRITE - WRITE ===
// (Locking check: T1 Updates, T2 tries to Update same row)
export async function testWriteWrite(isoLevel, options) {
    const pool = nodes.node1.pool;
    const report = [];
    const targetId = options.id;

    await seedTestRider(pool, options);

    const t1 = runTransaction(pool, async (conn) => {
        report.push(`[T1] Updating ID ${targetId}... (Holding Lock)`);
        await conn.query("UPDATE Riders SET age = 88 WHERE id = ?", [targetId]);
        await sleep(3000);
        report.push(`[T1] Committing.`);
    }, isoLevel);

    const t2 = runTransaction(pool, async (conn) => {
        await sleep(500);
        const start = Date.now();
        try {
            report.push(`[T2] Attempting update on ID ${targetId}...`);
            await conn.query("UPDATE Riders SET age = 99 WHERE id = ?", [targetId]);

            if (Date.now() - start > 2000) {
                report.push(`[RESULT] LOCKED: T2 waited for T1.`);
            } else {
                report.push(`[RESULT] NO LOCK: T2 overwrote immediately.`);
            }
        } catch (e) { report.push(`[T2] Error: ${e.message}`); }
    }, isoLevel);

    await Promise.allSettled([t1, t2]);
    return report;
}