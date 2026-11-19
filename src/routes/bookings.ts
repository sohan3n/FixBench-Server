import { Request, Response, Router } from "express";
import { Document, Filter, ObjectId, UpdateFilter } from "mongodb";
import { getCollections } from "../config/db.js";
import {
  verifyCustomer,
  verifyTechnician,
  verifyToken,
} from "../middlewares/auth.js";

const router = Router();

interface BookingStatusUpdateDoc {
  status: string;
  updatedAt: Date;
  finalAmount?: number;
  statusHistory: {
    status: string;
    changedAt: Date;
  }[];
}

const ACTIVE_BOOKING_STATUSES = ["requested", "accepted", "in-progress"];

const ALLOWED_BOOKING_STATUSES = new Set([
  "requested",
  "accepted",
  "rejected",
  "in-progress",
  "completed",
  "cancelled",
]);

// Challenge 3: Strict unidirectional job status state machine
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  requested: new Set(["accepted", "rejected"]),
  accepted: new Set(["in-progress"]),
  "in-progress": new Set(["completed"]),
};

function parsePreferredDate(rawDate: unknown): Date | null {
  if (typeof rawDate !== "string" || rawDate.trim().length === 0) {
    return null;
  }

  const trimmed = rawDate.trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    const utcDate = new Date(Date.UTC(year, month, day));

    if (
      utcDate.getUTCFullYear() !== year ||
      utcDate.getUTCMonth() !== month ||
      utcDate.getUTCDate() !== day
    ) {
      return null;
    }
    return utcDate;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

// ============================================================================
// CUSTOMER PROTECTED ROUTES
// ============================================================================

// POST /api/bookings — Submit a repair request (Customer only)
router.post(
  "/",
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response) => {
    try {
      const {
        serviceId,
        customerPhone,
        address,
        preferredDate,
        problemDescription,
      } = req.body as Record<string, unknown>;

      if (typeof serviceId !== "string" || !ObjectId.isValid(serviceId)) {
        res.status(400).json({ message: "Valid serviceId is required" });
        return;
      }

      if (typeof customerPhone !== "string" || customerPhone.trim().length < 6) {
        res
          .status(400)
          .json({ message: "Please enter a valid contact phone number" });
        return;
      }

      if (typeof address !== "string" || address.trim().length < 5) {
        res
          .status(400)
          .json({ message: "Service address must be at least 5 characters" });
        return;
      }

      const parsedPreferredDate = parsePreferredDate(preferredDate);
      if (!parsedPreferredDate) {
        res
          .status(400)
          .json({ message: "Please select a valid preferred date" });
        return;
      }

      // Allow today or any future date (with 14h UTC offset buffer for local timezones)
      const earliestAllowedMs = Date.now() - 14 * 60 * 60 * 1000;
      const startOfEarliestDay = new Date(earliestAllowedMs);
      startOfEarliestDay.setUTCHours(0, 0, 0, 0);

      if (parsedPreferredDate.getTime() < startOfEarliestDay.getTime()) {
        res
          .status(400)
          .json({ message: "Preferred date must be today or a future date" });
        return;
      }

      if (
        typeof problemDescription !== "string" ||
        problemDescription.trim().length < 20
      ) {
        res.status(400).json({
          message: "Problem description must be at least 20 characters long",
        });
        return;
      }

      const { servicesCollection, bookingsCollection } = getCollections();
      const service = await servicesCollection.findOne({
        _id: new ObjectId(serviceId),
        approvalStatus: "approved",
        isAvailable: true,
      });

      if (!service) {
        res.status(404).json({
          message: "This service is unavailable or no longer exists",
        });
        return;
      }

      const customerEmail = req.user!.email;
      const customerName = req.user!.name;

      // Guard against technician self-booking
      if (service.technicianEmail === customerEmail) {
        res.status(403).json({
          message: "Technicians cannot request their own service",
        });
        return;
      }

      // Guard against duplicate active requests for the same service
      const existingActiveBooking = await bookingsCollection.findOne({
        serviceId,
        customerEmail,
        status: { $in: ACTIVE_BOOKING_STATUSES },
      });

      if (existingActiveBooking) {
        res.status(409).json({
          message: "You already have an active request for this service",
        });
        return;
      }

      const now = new Date();
      const basePrice = Number(service.basePrice) || 0;

      const newBooking = {
        serviceId,
        serviceTitle: String(service.title || ""),
        serviceImage: String(service.image || ""),
        category: String(service.category || ""),
        basePrice,
        technicianName: String(service.technicianName || ""),
        technicianEmail: String(service.technicianEmail || ""),
        customerName,
        customerEmail,
        customerPhone: customerPhone.trim(),
        address: address.trim(),
        preferredDate: parsedPreferredDate,
        problemDescription: problemDescription.trim(),
        status: "requested" as const,
        finalAmount: basePrice,
        paymentStatus: "unpaid" as const,
        statusHistory: [
          {
            status: "requested" as const,
            changedAt: now,
          },
        ],
        rating: null,
        review: "",
        createdAt: now,
        updatedAt: now,
      };

      const result = await bookingsCollection.insertOne(newBooking);

      res.status(201).json({
        message: "Repair request submitted successfully",
        booking: {
          ...newBooking,
          _id: result.insertedId.toString(),
        },
      });
    } catch (error) {
      console.error("Error creating booking:", error);
      res.status(500).json({ message: "Failed to submit repair request" });
    }
  }
);

// GET /api/bookings/my — List all bookings belonging to the logged-in customer
router.get(
  "/my",
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response) => {
    try {
      const { bookingsCollection } = getCollections();
      const customerEmail = req.user!.email;

      const rawStatus =
        typeof req.query.status === "string"
          ? req.query.status.trim().toLowerCase()
          : "";

      const filter: Filter<Document> = { customerEmail };
      if (
        rawStatus &&
        rawStatus !== "all" &&
        ALLOWED_BOOKING_STATUSES.has(rawStatus)
      ) {
        filter.status = rawStatus;
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
      console.error("Error fetching customer bookings:", error);
      res.status(500).json({ message: "Failed to fetch your bookings" });
    }
  }
);

// ============================================================================
// TECHNICIAN PROTECTED ROUTES
// ============================================================================

// GET /api/bookings/technician — List all repair requests assigned to the logged-in technician
router.get(
  "/technician",
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response) => {
    try {
      const { bookingsCollection } = getCollections();
      const technicianEmail = req.user!.email;

      const rawStatus =
        typeof req.query.status === "string"
          ? req.query.status.trim().toLowerCase()
          : "";

      const filter: Filter<Document> = { technicianEmail };
      if (
        rawStatus &&
        rawStatus !== "all" &&
        ALLOWED_BOOKING_STATUSES.has(rawStatus)
      ) {
        filter.status = rawStatus;
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
      console.error("Error fetching technician bookings:", error);
      res.status(500).json({ message: "Failed to fetch incoming requests" });
    }
  }
);

// PATCH /api/bookings/:id/status — Technician job pipeline state machine (Challenge 3)
router.patch(
  "/:id/status",
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? "");
      if (!ObjectId.isValid(id)) {
        res.status(404).json({ message: "Booking not found" });
        return;
      }

      const { status: nextStatus, finalAmount } = req.body as {
        status?: unknown;
        finalAmount?: unknown;
      };

      if (typeof nextStatus !== "string" || nextStatus.trim().length === 0) {
        res.status(400).json({ message: "Target status is required" });
        return;
      }

      const { bookingsCollection } = getCollections();
      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        res.status(404).json({ message: "Booking not found" });
        return;
      }

      // Challenge 3: Only the technician who owns the job can update its status
      if (booking.technicianEmail !== req.user!.email) {
        res.status(403).json({
          message: "Forbidden: You can only update jobs assigned to you",
        });
        return;
      }

      const currentStatus = String(booking.status || "");
      const validNextStatuses = ALLOWED_TRANSITIONS[currentStatus];

      if (!validNextStatuses || !validNextStatuses.has(nextStatus)) {
        res.status(400).json({
          message: `Invalid status transition from '${currentStatus}' to '${nextStatus}'`,
        });
        return;
      }

      const now = new Date();
      const setFields: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: now,
      };

      // Challenge 3: Completing an in-progress job requires finalAmount > 0
      if (nextStatus === "completed") {
        const parsedAmount = Number(finalAmount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          res.status(400).json({
            message:
              "A valid final amount greater than 0 is required when completing a job",
          });
          return;
        }
        setFields.finalAmount = Math.round(parsedAmount * 100) / 100;
      }

      const historyEntry = {
        status: nextStatus,
        changedAt: now,
      };

      const updateDoc: UpdateFilter<BookingStatusUpdateDoc> = {
        $set: setFields,
        $push: {
          statusHistory: historyEntry,
        },
      };

      await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc as UpdateFilter<Document>
      );

      const existingHistory = Array.isArray(booking.statusHistory)
        ? booking.statusHistory
        : [];

      res.status(200).json({
        message: `Booking status updated to '${nextStatus}'`,
        booking: {
          ...booking,
          ...setFields,
          _id: id,
          statusHistory: [...existingHistory, historyEntry],
        },
      });
    } catch (error) {
      console.error("Error updating booking status:", error);
      res.status(500).json({ message: "Failed to update job status" });
    }
  }
);

// ============================================================================
// CUSTOMER POST-BOOKING MUTATIONS (Cancel & Post-Payment Review)
// ============================================================================

// PATCH /api/bookings/:id/cancel — Cancel a booking while status is still 'requested'
router.patch(
  "/:id/cancel",
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? "");
      if (!ObjectId.isValid(id)) {
        res.status(404).json({ message: "Booking not found" });
        return;
      }

      const { bookingsCollection } = getCollections();
      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        res.status(404).json({ message: "Booking not found" });
        return;
      }

      if (booking.customerEmail !== req.user!.email) {
        res.status(403).json({
          message: "Forbidden: You can only cancel your own bookings",
        });
        return;
      }

      if (booking.status !== "requested") {
        res.status(400).json({
          message: "Only bookings in 'requested' status can be cancelled",
        });
        return;
      }

      const now = new Date();
      const historyEntry = {
        status: "cancelled" as const,
        changedAt: now,
      };

      const updateDoc: UpdateFilter<BookingStatusUpdateDoc> = {
        $set: {
          status: "cancelled",
          updatedAt: now,
        },
        $push: {
          statusHistory: historyEntry,
        },
      };

      await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc as UpdateFilter<Document>
      );

      const existingHistory = Array.isArray(booking.statusHistory)
        ? booking.statusHistory
        : [];

      res.status(200).json({
        message: "Booking cancelled successfully",
        booking: {
          ...booking,
          _id: id,
          status: "cancelled",
          updatedAt: now,
          statusHistory: [...existingHistory, historyEntry],
        },
      });
    } catch (error) {
      console.error("Error cancelling booking:", error);
      res.status(500).json({ message: "Failed to cancel booking" });
    }
  }
);

// PATCH /api/bookings/:id/review — Customer post-payment 1-5 star rating & review (Optional 2)
router.patch(
  "/:id/review",
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? "");
      if (!ObjectId.isValid(id)) {
        res.status(404).json({ message: "Booking not found" });
        return;
      }

      const { rating, review } = req.body as {
        rating?: unknown;
        review?: unknown;
      };

      const parsedRating = Number(rating);
      if (
        !Number.isInteger(parsedRating) ||
        parsedRating < 1 ||
        parsedRating > 5
      ) {
        res
          .status(400)
          .json({ message: "Rating must be a whole number between 1 and 5" });
        return;
      }

      if (
        typeof review !== "string" ||
        review.trim().length < 3 ||
        review.trim().length > 500
      ) {
        res.status(400).json({
          message: "Review must be between 3 and 500 characters long",
        });
        return;
      }

      const { bookingsCollection } = getCollections();
      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!booking) {
        res.status(404).json({ message: "Booking not found" });
        return;
      }

      if (booking.customerEmail !== req.user!.email) {
        res.status(403).json({
          message: "Forbidden: You can only review your own bookings",
        });
        return;
      }

      if (booking.status !== "completed" || booking.paymentStatus !== "paid") {
        res.status(400).json({
          message: "You can only rate and review a completed and paid booking",
        });
        return;
      }

      if (typeof booking.rating === "number") {
        res.status(409).json({
          message: "You have already submitted a review for this booking",
        });
        return;
      }

      const now = new Date();
      const trimmedReview = review.trim();

      await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            rating: parsedRating,
            review: trimmedReview,
            updatedAt: now,
          },
        }
      );

      res.status(200).json({
        message: "Thank you! Your rating and review have been submitted",
        booking: {
          ...booking,
          _id: id,
          rating: parsedRating,
          review: trimmedReview,
          updatedAt: now,
        },
      });
    } catch (error) {
      console.error("Error submitting booking review:", error);
      res.status(500).json({ message: "Failed to submit review" });
    }
  }
);

export default router;