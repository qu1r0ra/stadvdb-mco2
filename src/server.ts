import express, { Request, Response } from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";

import ridersRouter from "./routes/riders";
import recoveryRouter from "./routes/recovery";

dotenv.config();

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use("/api/riders", ridersRouter);
app.use("/api/recovery", recoveryRouter);

// Health check
app.get("/", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Server start
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
});
