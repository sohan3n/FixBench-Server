import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import userRoutes from "./routes/users.js";
import serviceRoutes from "./routes/services.js";
import bookingRoutes from "./routes/bookings.js";
import adminRoutes from "./routes/admin.js";

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

// Public & Protected Domain Routes
app.use("/api/users", userRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);

// 404 Fallback for unknown API routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: "API route not found" });
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