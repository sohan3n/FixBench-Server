import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  process.env.CLIENT_URL || "http://localhost:3000",
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Note: Stripe raw-body webhook route will be mounted BEFORE express.json() in Phase 2.6
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "FixBench API",
    timestamp: new Date().toISOString(),
  });
});

async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`FixBench server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start FixBench server:", error);
    process.exit(1);
  }
}

startServer();