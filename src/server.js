import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

import ridersRouter from "./routes/riders.js";
import recoveryRouter from "./routes/recovery.js";
import replicationRouter from "./routes/replication.js";
import testRouter from "./routes/testRouter.js";
// Import the new function
import { getRidersFromNode } from "./services/ridersService.js";

dotenv.config();

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. SERVE STATIC FILES (CSS)
app.use(express.static(path.join(__dirname, '../public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(bodyParser.json());

app.use("/api/riders", ridersRouter);
app.use("/api/recovery", recoveryRouter);
app.use("/api/replication", replicationRouter);
app.use("/api/test", testRouter);

// 2. FETCH ALL 3 DATASETS
app.get("/", async (req, res) => {
  try {
    // Fetch from all 3 nodes in parallel
    const [node1Data, node2Data, node3Data] = await Promise.all([
      getRidersFromNode("node1"),
      getRidersFromNode("node2"),
      getRidersFromNode("node3")
    ]);

    // Send all 3 to the dashboard
    res.render("dashboard", {
      node1: node1Data,
      node2: node2Data,
      node3: node3Data
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading database: " + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`App running at http://localhost:${PORT}`);
});