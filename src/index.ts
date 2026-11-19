import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import userRoutes from "./routes/users.js";
import serviceRoutes from "./routes/services.js";
import bookingRoutes from "./routes/bookings.js";
import adminRoutes from "./routes/admin.js";
import paymentRoutes, { stripeWebhookHandler } from "./routes/payments.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

const configuredOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedOrigins = new Set<string>([
  "http://localhost:3000",
  ...configuredOrigins,
]);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server calls, Stripe webhooks, and direct browser health checks
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = normalizeOrigin(origin);
      if (allowedOrigins.has(normalized)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked for origin: ${origin}`));
      }
    },
    credentials: true,
  })
);

// Ensure MongoDB is connected on Vercel serverless cold starts
async function ensureDbConnected(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("Database connection error:", error);
    res.status(500).json({ message: "Database connection failed" });
  }
}

// Stripe Webhook MUST receive the raw unparsed body before express.json()
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  ensureDbConnected,
  stripeWebhookHandler
);

app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "FixBench API",
    message: "FixBench Express server is running",
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "FixBench API",
    timestamp: new Date().toISOString(),
  });
});

// Public & Protected Domain Routes
app.use("/api/users", ensureDbConnected, userRoutes);
app.use("/api/services", ensureDbConnected, serviceRoutes);
app.use("/api/bookings", ensureDbConnected, bookingRoutes);
app.use("/api/admin", ensureDbConnected, adminRoutes);
app.use("/api/payments", ensureDbConnected, paymentRoutes);

// 404 Fallback for unknown API routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: "API route not found" });
});

// Local development listener (Vercel uses exported default app)
if (!process.env.VERCEL) {
  connectDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`FixBench server running on http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      console.error("Failed to start FixBench server:", error);
      process.exit(1);
    });
}

export default app;