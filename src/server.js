import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";

import ridersRouter from "./routes/riders.js";
import recoveryRouter from "./routes/recovery.js";
import replicationRouter from "./routes/replication.js";
import { startHealthMonitoring } from "./services/failoverService.js";

dotenv.config();

const app = express();
app.use(bodyParser.json());

app.use("/api/riders", ridersRouter);
app.use("/api/recovery", recoveryRouter);
app.use("/api/replication", replicationRouter);

app.get("/", (_req, res) => res.json({ status: "ok" }));

app.listen(process.env.PORT, () => {
  console.log(`Backend running on port ${process.env.PORT}`);

  // Start health monitoring for automatic failover
  startHealthMonitoring();
});
