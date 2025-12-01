import { nodes } from "../config/db.js";
import { runTransaction } from "../utils/transactions.js";
import sleep from "../utils/sleep.js";

// CASE 1: Concurrent Reads (Node 1)
export async function testConcurrentReads(isoLevel) {
    const pool = nodes.node1.pool;
    const log = [];

    const t1 = runTransaction(pool, async (conn) => {
        log.push("T1 Start Read");
        await conn.query("SELECT * FROM Riders LIMIT 1");
        await sleep(2000); // Hold lock
        log.push("T1 End Read");
        return "T1 Done";
    }, isoLevel);

    const t2 = runTransaction(pool, async (conn) => {
        await sleep(500); // Start slightly after T1
        log.push("T2 Start Read");
        await conn.query("SELECT * FROM Riders LIMIT 1");
        log.push("T2 End Read");
        return "T2 Done";
    }, isoLevel);

    await Promise.allSettled([t1, t2]);
    return log;
}

// CASE 2: Concurrent Read (T1) and Write (T2)
export async function testReadWrite(isoLevel) {
    const pool = nodes.node1.pool;
    const log = [];

    // T1: Reads, sleeps, reads again (to check for phantom/unrepeatable)
    const t1 = runTransaction(pool, async (conn) => {
        log.push("T1: Read 1");
        const [rows1] = await conn.query("SELECT count(*) as c FROM Riders");

        await sleep(2000);

        log.push("T1: Read 2");
        const [rows2] = await conn.query("SELECT count(*) as c FROM Riders");
        return { before: rows1[0].c, after: rows2[0].c };
    }, isoLevel);

    // T2: Inserts a rider
    const t2 = runTransaction(pool, async (conn) => {
        await sleep(500);
        log.push("T2: Insert Start");
        await conn.query("INSERT INTO Riders (firstName, courierName) VALUES ('Test', 'JNT')");
        log.push("T2: Insert End");
    }, isoLevel);

    const results = await Promise.allSettled([t1, t2]);
    return { log, results };
}

// CASE 3: Concurrent Writes (same ID)
export async function testWriteWrite(isoLevel, idToUpdate) {
    const pool = nodes.node1.pool;
    const log = [];

    const t1 = runTransaction(pool, async (conn) => {
        log.push("T1: Update Start");
        await conn.query("UPDATE Riders SET age = 99 WHERE id = ?", [idToUpdate]);
        await sleep(2000); // Hold lock
        log.push("T1: Update End");
    }, isoLevel);

    const t2 = runTransaction(pool, async (conn) => {
        await sleep(500);
        log.push("T2: Update Start (waiting...)");
        await conn.query("UPDATE Riders SET age = 100 WHERE id = ?", [idToUpdate]);
        log.push("T2: Update End");
    }, isoLevel);

    await Promise.allSettled([t1, t2]);
    return log;
}