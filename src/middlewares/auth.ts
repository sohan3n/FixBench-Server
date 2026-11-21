import { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getCollections } from "../config/db.js";
import { TechnicianPlan, UserRole } from "../types/index.js";

const rawJwksBase =
  process.env.JWKS_URL ||
  process.env.BETTER_AUTH_URL ||
  (process.env.CLIENT_URL || "http://localhost:3000")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");

const jwksUrl = `${rawJwksBase.replace(/\/+$/, "")}/api/auth/jwks`;
const JWKS = createRemoteJWKSet(new URL(jwksUrl));

export async function verifyToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ message: "Unauthorized: Missing Bearer token" });
      return;
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      res.status(401).json({ message: "Unauthorized: Malformed token" });
      return;
    }

    const { payload } = await jwtVerify(token, JWKS);
    const email = typeof payload.email === "string" ? payload.email : null;

    if (!email) {
      res.status(401).json({ message: "Unauthorized: Invalid token payload" });
      return;
    }

    // Load live user record from MongoDB so role & plan updates apply immediately
    const { usersCollection } = getCollections();
    const dbUser = await usersCollection.findOne({ email });

    if (!dbUser || !dbUser._id) {
      res.status(401).json({ message: "Unauthorized: User account not found" });
      return;
    }

    req.user = {
      id: dbUser._id.toString(),
      email: dbUser.email,
      name: dbUser.name,
      role: (dbUser.role || "customer") as UserRole,
      plan: (dbUser.plan || "free") as TechnicianPlan,
    };

    next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized: Invalid or expired token" });
  }
}

export function verifyCustomer(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  if (req.user.role !== "customer") {
    res.status(403).json({ message: "Forbidden: Customer access required" });
    return;
  }
  next();
}

export function verifyTechnician(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  if (req.user.role !== "technician") {
    res.status(403).json({ message: "Forbidden: Technician access required" });
    return;
  }
  next();
}

export function verifyAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ message: "Forbidden: Admin access required" });
    return;
  }
  next();
}