import { Router } from "express";
console.log(">>> LOADING src/routes/riders.js <<<");
import {
  insertRider,
  updateRider,
  deleteRider,
  getAllRiders,
} from "../services/ridersService.js";

const router = Router();

// GET all riders
router.get("/", async (_req, res) => {
  try {
    const rows = await getAllRiders();
    res.json(rows);
  } catch (err) {
    console.error("GET /riders error:", err);
    res.status(500).json({ error: "Failed to fetch riders" });
  }
});

// POST create rider
router.post("/", async (req, res) => {
  try {
    const result = await insertRider(req.body);
    res.json({ status: "ok", ...result });
  } catch (err) {
    console.error("POST /riders error:", err);
    res.status(500).json({ error: "Insert failed", details: err.message });
  }
});

// PUT update rider
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await updateRider(id, req.body);
    res.json({ status: "updated", ...result });
  } catch (err) {
    console.error("PUT /riders error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// DELETE rider
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await deleteRider(id, req.body?.courierName);
    res.json({ status: "deleted", ...result });
  } catch (err) {
    console.error("DELETE /riders error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
