import { Request, Response, Router } from "express";
import { Document, Filter, ObjectId } from "mongodb";
import { getCollections } from "../config/db.js";
import { verifyAdmin, verifyToken } from "../middlewares/auth.js";

const router = Router();

const ALLOWED_ROLES = new Set(["customer", "technician", "admin"]);
const ALLOWED_APPROVAL_STATUSES = new Set(["pending", "approved", "rejected"]);
const ALLOWED_BOOKING_STATUSES = new Set([
  "requested",
  "accepted",
  "rejected",
  "in-progress",
  "completed",
  "cancelled",
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Lock every route in this router to authenticated Admins only
router.use(verifyToken, verifyAdmin);

// GET /api/admin/stats — Platform KPIs & monthly trend data for Admin Overview
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const {
      usersCollection,
      servicesCollection,
      bookingsCollection,
      paymentsCollection,
    } = getCollections();

    const [
      totalUsers,
      totalTechnicians,
      totalCustomers,
      pendingServices,
      totalServices,
      totalBookings,
      revenueAgg,
      monthlyPaymentsAgg,
    ] = await Promise.all([
      usersCollection.countDocuments({}),
      usersCollection.countDocuments({ role: "technician" }),
      usersCollection.countDocuments({ role: "customer" }),
      servicesCollection.countDocuments({ approvalStatus: "pending" }),
      servicesCollection.countDocuments({}),
      bookingsCollection.countDocuments({}),
      paymentsCollection
        .aggregate([
          { $match: { paymentStatus: "paid" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ])
        .toArray(),
      paymentsCollection
        .aggregate([
          { $match: { paymentStatus: "paid", paidAt: { $type: "date" } } },
          {
            $group: {
              _id: {
                year: { $year: "$paidAt" },
                month: { $month: "$paidAt" },
              },
              revenue: { $sum: "$amount" },
              transactions: { $sum: 1 },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
          { $limit: 12 },
        ])
        .toArray(),
    ]);

    const totalRevenue =
      Math.round((Number(revenueAgg[0]?.total) || 0) * 100) / 100;

    const monthlyStats = monthlyPaymentsAgg.map((item) => {
      const year = item._id?.year ?? new Date().getUTCFullYear();
      const month = String(item._id?.month ?? 1).padStart(2, "0");
      return {
        month: `${year}-${month}`,
        revenue: Math.round((Number(item.revenue) || 0) * 100) / 100,
        transactions: Number(item.transactions) || 0,
      };
    });

    res.status(200).json({
      stats: {
        totalUsers,
        totalTechnicians,
        totalCustomers,
        pendingServices,
        totalServices,
        totalBookings,
        totalRevenue,
      },
      monthlyStats,
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({ message: "Failed to fetch platform statistics" });
  }
});

// GET /api/admin/users — List all registered users with optional role & search filters
router.get("/users", async (req: Request, res: Response) => {
  try {
    const { usersCollection } = getCollections();

    const rawRole =
      typeof req.query.role === "string"
        ? req.query.role.trim().toLowerCase()
        : "";
    const rawSearch =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const filter: Filter<Document> = {};

    if (rawRole && rawRole !== "all" && ALLOWED_ROLES.has(rawRole)) {
      filter.role = rawRole;
    }

    if (rawSearch.length > 0) {
      const safePattern = new RegExp(escapeRegex(rawSearch), "i");
      filter.$or = [{ name: safePattern }, { email: safePattern }];
    }

    const rawUsers = await usersCollection
      .find(filter, {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          plan: 1,
          phone: 1,
          area: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .toArray();

    const users = rawUsers.map((user) => ({
      _id: user._id.toString(),
      name: user.name || "",
      email: user.email || "",
      image: user.image || "",
      role: user.role || "customer",
      plan: user.plan === "pro" ? "pro" : "free",
      phone: user.phone || "",
      area: user.area || "",
      createdAt: user.createdAt,
    }));

    res.status(200).json({ users });
  } catch (error) {
    console.error("Error fetching admin users:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// PATCH /api/admin/users/:id/role — Change a user's role (blocks admin self-demotion)
router.patch("/users/:id/role", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!ObjectId.isValid(id)) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const { role } = req.body as { role?: unknown };
    if (typeof role !== "string" || !ALLOWED_ROLES.has(role)) {
      res.status(400).json({
        message: "Role must be 'customer', 'technician', or 'admin'",
      });
      return;
    }

    const { usersCollection } = getCollections();
    const targetUser = await usersCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!targetUser) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Strict guard: Admin cannot change their own role
    if (
      targetUser._id.toString() === req.user!.id ||
      targetUser.email === req.user!.email
    ) {
      res.status(403).json({
        message: "Forbidden: You cannot change your own admin role",
      });
      return;
    }

    const updatedAt = new Date();
    await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role, updatedAt } }
    );

    res.status(200).json({
      message: `User role updated to '${role}'`,
      user: {
        _id: id,
        name: targetUser.name,
        email: targetUser.email,
        image: targetUser.image || "",
        role,
        plan: targetUser.plan === "pro" ? "pro" : "free",
        createdAt: targetUser.createdAt,
        updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating user role:", error);
    res.status(500).json({ message: "Failed to update user role" });
  }
});

// GET /api/admin/services — List all services (Pending-first priority sorting)
router.get("/services", async (req: Request, res: Response) => {
  try {
    const { servicesCollection } = getCollections();

    const rawStatus =
      typeof req.query.status === "string"
        ? req.query.status.trim().toLowerCase()
        : "";

    const matchStage: Filter<Document> = {};
    if (
      rawStatus &&
      rawStatus !== "all" &&
      ALLOWED_APPROVAL_STATUSES.has(rawStatus)
    ) {
      matchStage.approvalStatus = rawStatus;
    }

    const rawServices = await servicesCollection
      .aggregate([
        { $match: matchStage },
        {
          $addFields: {
            statusPriority: {
              $switch: {
                branches: [
                  { case: { $eq: ["$approvalStatus", "pending"] }, then: 0 },
                  { case: { $eq: ["$approvalStatus", "approved"] }, then: 1 },
                  { case: { $eq: ["$approvalStatus", "rejected"] }, then: 2 },
                ],
                default: 3,
              },
            },
          },
        },
        { $sort: { statusPriority: 1, createdAt: -1 } },
        { $project: { statusPriority: 0 } },
      ])
      .toArray();

    const services = rawServices.map((service) => ({
      ...service,
      _id: service._id.toString(),
    }));

    res.status(200).json({ services });
  } catch (error) {
    console.error("Error fetching admin services:", error);
    res.status(500).json({ message: "Failed to fetch services" });
  }
});

// PATCH /api/admin/services/:id/approval — Approve or reject a service listing
router.patch("/services/:id/approval", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!ObjectId.isValid(id)) {
      res.status(404).json({ message: "Service not found" });
      return;
    }

    const { approvalStatus } = req.body as { approvalStatus?: unknown };
    if (approvalStatus !== "approved" && approvalStatus !== "rejected") {
      res.status(400).json({
        message: "approvalStatus must be 'approved' or 'rejected'",
      });
      return;
    }

    const { servicesCollection } = getCollections();
    const existing = await servicesCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existing) {
      res.status(404).json({ message: "Service not found" });
      return;
    }

    const updatedAt = new Date();
    await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { approvalStatus, updatedAt } }
    );

    res.status(200).json({
      message: `Service ${approvalStatus} successfully`,
      service: {
        ...existing,
        _id: id,
        approvalStatus,
        updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating service approval:", error);
    res.status(500).json({ message: "Failed to update service approval status" });
  }
});

// GET /api/admin/bookings — Read-only platform-wide monitor of all bookings
router.get("/bookings", async (req: Request, res: Response) => {
  try {
    const { bookingsCollection } = getCollections();

    const rawStatus =
      typeof req.query.status === "string"
        ? req.query.status.trim().toLowerCase()
        : "";
    const rawSearch =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const filter: Filter<Document> = {};
    if (
      rawStatus &&
      rawStatus !== "all" &&
      ALLOWED_BOOKING_STATUSES.has(rawStatus)
    ) {
      filter.status = rawStatus;
    }

    if (rawSearch.length > 0) {
      const safePattern = new RegExp(escapeRegex(rawSearch), "i");
      filter.$or = [
        { serviceTitle: safePattern },
        { customerName: safePattern },
        { customerEmail: safePattern },
        { technicianName: safePattern },
        { technicianEmail: safePattern },
      ];
    }

    const rawBookings = await bookingsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    const bookings = rawBookings.map((booking) => ({
      ...booking,
      _id: booking._id.toString(),
    }));

    res.status(200).json({ bookings });
  } catch (error) {
    console.error("Error fetching admin bookings:", error);
    res.status(500).json({ message: "Failed to fetch platform bookings" });
  }
});

// GET /api/admin/payments — All Stripe payment records + aggregated platform revenue
router.get("/payments", async (_req: Request, res: Response) => {
  try {
    const { paymentsCollection } = getCollections();

    const [rawPayments, revenueAgg] = await Promise.all([
      paymentsCollection.find({}).sort({ paidAt: -1 }).toArray(),
      paymentsCollection
        .aggregate([
          { $match: { paymentStatus: "paid" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ])
        .toArray(),
    ]);

    const payments = rawPayments.map((payment) => ({
      ...payment,
      _id: payment._id.toString(),
    }));

    const totalRevenue =
      Math.round((Number(revenueAgg[0]?.total) || 0) * 100) / 100;

    res.status(200).json({
      payments,
      totalRevenue,
      totalTransactions: payments.length,
    });
  } catch (error) {
    console.error("Error fetching admin payments:", error);
    res.status(500).json({ message: "Failed to fetch payment transactions" });
  }
});

export default router;