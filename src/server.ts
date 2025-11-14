import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";

import ridersRouter from "./routes/riders";
import recoveryRouter from "./routes/recovery";

dotenv.config();

const app = express();
app.use(bodyParser.json());

app.use("/api/riders", ridersRouter);
app.use("/api/recovery", recoveryRouter);

app.get("/", (_req, res) => res.json({ status: "ok" }));

app.listen(process.env.PORT, () => {
  console.log(`Backend running on port ${process.env.PORT}`);
});
