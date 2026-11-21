import { Request, Response, Router } from "express";
import { Document, Filter, ObjectId, Sort } from "mongodb";
import { getCollections } from "../config/db.js";
import { verifyTechnician, verifyToken } from "../middlewares/auth.js";

const router = Router();

const FREE_PLAN_SERVICE_LIMIT = 2;

const ALLOWED_CATEGORIES = new Set([
  "Smartphone",
  "Laptop & PC",
  "AC",
  "Refrigerator",
  "TV",
  "Washing Machine",
  "Electrical",
]);

const ALLOWED_SERVICE_MODES = new Set(["Home Visit", "Shop Drop-off"]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ============================================================================
// PUBLIC ROUTES
// ============================================================================

// GET /api/services — Public approved & available services with search, filter, sort & pagination
router.get("/", async (req: Request, res: Response) => {
  try {
    const { servicesCollection, usersCollection, bookingsCollection } =
      getCollections();

    const rawSearch =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const rawCategory =
      typeof req.query.category === "string" ? req.query.category.trim() : "";
    const rawMode =
      typeof req.query.serviceMode === "string"
        ? req.query.serviceMode.trim()
        : "";
    const rawSort =
      typeof req.query.sort === "string" ? req.query.sort.trim() : "newest";

    const parsedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const parsedLimit = Number.parseInt(String(req.query.limit ?? "9"), 10);

    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 50)
        : 9;
    const skip = (page - 1) * limit;

    // Mandatory public visibility gate
    const filter: Filter<Document> = {
      approvalStatus: "approved",
      isAvailable: true,
    };

    if (rawSearch.length > 0) {
      const safePattern = new RegExp(escapeRegex(rawSearch), "i");
      filter.$or = [{ title: safePattern }, { category: safePattern }];
    }

    if (
      rawCategory &&
      rawCategory !== "All" &&
      ALLOWED_CATEGORIES.has(rawCategory)
    ) {
      filter.category = rawCategory;
    }

    if (rawMode && rawMode !== "All" && ALLOWED_SERVICE_MODES.has(rawMode)) {
      filter.serviceMode = rawMode;
    }

    let sortStage: Sort = { createdAt: -1 };
    if (rawSort === "price_asc") {
      sortStage = { basePrice: 1, createdAt: -1 };
    } else if (rawSort === "price_desc") {
      sortStage = { basePrice: -1, createdAt: -1 };
    }

    const [total, rawServices] = await Promise.all([
      servicesCollection.countDocuments(filter),
      servicesCollection
        .find(filter)
        .sort(sortStage)
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    // Batch-enrich cards with technician Pro plan & aggregated booking ratings
    const serviceIds = rawServices.map((s) => s._id.toString());
    const technicianEmails = Array.from(
      new Set(
        rawServices
          .map((s) => s.technicianEmail)
          .filter((email): email is string => typeof email === "string")
      )
    );

    const [technicians, ratingStats] = await Promise.all([
      technicianEmails.length > 0
        ? usersCollection
            .find(
              { email: { $in: technicianEmails } },
              { projection: { email: 1, plan: 1, image: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
      serviceIds.length > 0
        ? bookingsCollection
            .aggregate([
              {
                $match: {
                  serviceId: { $in: serviceIds },
                  rating: { $gte: 1, $lte: 5 },
                },
              },
              {
                $group: {
                  _id: "$serviceId",
                  averageRating: { $avg: "$rating" },
                  reviewCount: { $sum: 1 },
                },
              },
            ])
            .toArray()
        : Promise.resolve([]),
    ]);

    const techPlanMap = new Map<string, string>();
    for (const tech of technicians) {
      if (typeof tech.email === "string") {
        techPlanMap.set(tech.email, tech.plan === "pro" ? "pro" : "free");
      }
    }

    const ratingMap = new Map<
      string,
      { averageRating: number; reviewCount: number }
    >();
    for (const stat of ratingStats) {
      if (typeof stat._id === "string") {
        ratingMap.set(stat._id, {
          averageRating:
            Math.round((Number(stat.averageRating) || 0) * 10) / 10,
          reviewCount: Number(stat.reviewCount) || 0,
        });
      }
    }

    const services = rawServices.map((service) => {
      const id = service._id.toString();
      const ratingInfo = ratingMap.get(id) ?? {
        averageRating: 0,
        reviewCount: 0,
      };

      return {
        ...service,
        _id: id,
        technicianPlan: techPlanMap.get(service.technicianEmail) ?? "free",
        averageRating: ratingInfo.averageRating,
        reviewCount: ratingInfo.reviewCount,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.status(200).json({
      services,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching public services:", error);
    res.status(500).json({ message: "Failed to fetch services" });
  }
});

// ============================================================================
// TECHNICIAN PROTECTED ROUTES (Must stay ABOVE /:id)
// ============================================================================

// GET /api/services/my — List all services owned by the logged-in technician + plan quota
router.get(
  "/my",
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response) => {
    try {
      const { servicesCollection, bookingsCollection } = getCollections();
      const technicianEmail = req.user!.email;
      const plan = req.user!.plan === "pro" ? "pro" : "free";

      const rawServices = await servicesCollection
        .find({ technicianEmail })
        .sort({ createdAt: -1 })
        .toArray();

      const serviceIds = rawServices.map((s) => s._id.toString());

      const ratingStats =
        serviceIds.length > 0
          ? await bookingsCollection
              .aggregate([
                {
                  $match: {
                    serviceId: { $in: serviceIds },
                    rating: { $gte: 1, $lte: 5 },
                  },
                },
                {
                  $group: {
                    _id: "$serviceId",
                    averageRating: { $avg: "$rating" },
                    reviewCount: { $sum: 1 },
                  },
                },
              ])
              .toArray()
          : [];

      const ratingMap = new Map<
        string,
        { averageRating: number; reviewCount: number }
      >();
      for (const stat of ratingStats) {
        if (typeof stat._id === "string") {
          ratingMap.set(stat._id, {
            averageRating:
              Math.round((Number(stat.averageRating) || 0) * 10) / 10,
            reviewCount: Number(stat.reviewCount) || 0,
          });
        }
      }

      const services = rawServices.map((service) => {
        const id = service._id.toString();
        const ratingInfo = ratingMap.get(id) ?? {
          averageRating: 0,
          reviewCount: 0,
        };

        return {
          ...service,
          _id: id,
          averageRating: ratingInfo.averageRating,
          reviewCount: ratingInfo.reviewCount,
        };
      });

      const currentCount = services.length;
      const maxAllowed = plan === "pro" ? null : FREE_PLAN_SERVICE_LIMIT;
      const canAddService =
        plan === "pro" || currentCount < FREE_PLAN_SERVICE_LIMIT;

      res.status(200).json({
        services,
        quota: {
          plan,
          currentCount,
          maxAllowed,
          canAddService,
        },
      });
    } catch (error) {
      console.error("Error fetching technician services:", error);
      res.status(500).json({ message: "Failed to fetch your services" });
    }
  }
);

// POST /api/services — Create a new service (enforces Free-tier 3-service cap & pending status)
router.post(
  "/",
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response) => {
    try {
      const { servicesCollection } = getCollections();
      const technicianEmail = req.user!.email;
      const technicianName = req.user!.name;
      const plan = req.user!.plan === "pro" ? "pro" : "free";

      // Enforce Free-tier service quota (Optional Requirement 1)
      if (plan !== "pro") {
        const existingCount = await servicesCollection.countDocuments({
          technicianEmail,
        });

        if (existingCount >= FREE_PLAN_SERVICE_LIMIT) {
          res.status(403).json({
            message:
              "Free plan technicians can list up to 2 services. Upgrade to Pro for unlimited listings.",
            code: "FREE_PLAN_LIMIT_REACHED",
          });
          return;
        }
      }

      const {
        title,
        category,
        description,
        image,
        basePrice,
        estimatedDuration,
        serviceMode,
        serviceArea,
      } = req.body as Record<string, unknown>;

      if (typeof title !== "string" || title.trim().length < 3) {
        res
          .status(400)
          .json({ message: "Service title must be at least 3 characters long" });
        return;
      }

      if (typeof category !== "string" || !ALLOWED_CATEGORIES.has(category)) {
        res.status(400).json({ message: "Invalid service category selected" });
        return;
      }

      if (typeof description !== "string" || description.trim().length < 15) {
        res.status(400).json({
          message: "Description must be at least 15 characters long",
        });
        return;
      }

      if (typeof image !== "string" || !isValidHttpUrl(image.trim())) {
        res
          .status(400)
          .json({ message: "A valid uploaded service image URL is required" });
        return;
      }

      const parsedPrice = Number(basePrice);
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        res
          .status(400)
          .json({ message: "Base price must be a positive number" });
        return;
      }

      if (
        typeof estimatedDuration !== "string" ||
        estimatedDuration.trim().length === 0
      ) {
        res.status(400).json({ message: "Estimated duration is required" });
        return;
      }

      if (
        typeof serviceMode !== "string" ||
        !ALLOWED_SERVICE_MODES.has(serviceMode)
      ) {
        res.status(400).json({
          message: "Service mode must be 'Home Visit' or 'Shop Drop-off'",
        });
        return;
      }

      if (typeof serviceArea !== "string" || serviceArea.trim().length < 2) {
        res.status(400).json({ message: "Service area is required" });
        return;
      }

      const now = new Date();
      const newService = {
        title: title.trim(),
        category,
        description: description.trim(),
        image: image.trim(),
        basePrice: Math.round(parsedPrice * 100) / 100,
        estimatedDuration: estimatedDuration.trim(),
        serviceMode,
        serviceArea: serviceArea.trim(),
        technicianName,
        technicianEmail,
        approvalStatus: "pending" as const,
        isAvailable: true,
        createdAt: now,
        updatedAt: now,
      };

      const result = await servicesCollection.insertOne(newService);

      res.status(201).json({
        message: "Service created and submitted for admin approval",
        service: {
          ...newService,
          _id: result.insertedId.toString(),
        },
      });
    } catch (error) {
      console.error("Error creating service:", error);
      res.status(500).json({ message: "Failed to create service" });
    }
  }
);

// PATCH /api/services/:id/availability — Toggle isAvailable without resetting approvalStatus
router.patch(
  "/:id/availability",
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? "");
      if (!ObjectId.isValid(id)) {
        res.status(404).json({ message: "Service not found" });
        return;
      }

      const { isAvailable } = req.body as { isAvailable?: unknown };
      if (typeof isAvailable !== "boolean") {
        res
          .status(400)
          .json({ message: "isAvailable must be a boolean value" });
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

      if (existing.technicianEmail !== req.user!.email) {
        res.status(403).json({
          message: "Forbidden: You can only update your own services",
        });
        return;
      }

      const updatedAt = new Date();
      await servicesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isAvailable, updatedAt } }
      );

      res.status(200).json({
        message: `Service is now ${isAvailable ? "available" : "unavailable"}`,
        service: {
          ...existing,
          _id: id,
          isAvailable,
          updatedAt,
        },
      });
    } catch (error) {
      console.error("Error toggling service availability:", error);
      res.status(500).json({ message: "Failed to update service availability" });
    }
  }
);

// PATCH /api/services/:id — Edit service details (resets approvalStatus to 'pending')
router.patch(
  "/:id",
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? "");
      if (!ObjectId.isValid(id)) {
        res.status(404).json({ message: "Service not found" });
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

      if (existing.technicianEmail !== req.user!.email) {
        res.status(403).json({
          message: "Forbidden: You can only edit your own services",
        });
        return;
      }

      const {
        title,
        category,
        description,
        image,
        basePrice,
        estimatedDuration,
        serviceMode,
        serviceArea,
        isAvailable,
      } = req.body as Record<string, unknown>;

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      let hasContentEdit = false;

      if (title !== undefined) {
        if (typeof title !== "string" || title.trim().length < 3) {
          res.status(400).json({
            message: "Service title must be at least 3 characters long",
          });
          return;
        }
        updates.title = title.trim();
        hasContentEdit = true;
      }

      if (category !== undefined) {
        if (typeof category !== "string" || !ALLOWED_CATEGORIES.has(category)) {
          res.status(400).json({ message: "Invalid service category" });
          return;
        }
        updates.category = category;
        hasContentEdit = true;
      }

      if (description !== undefined) {
        if (typeof description !== "string" || description.trim().length < 15) {
          res.status(400).json({
            message: "Description must be at least 15 characters long",
          });
          return;
        }
        updates.description = description.trim();
        hasContentEdit = true;
      }

      if (image !== undefined) {
        if (typeof image !== "string" || !isValidHttpUrl(image.trim())) {
          res
            .status(400)
            .json({ message: "A valid uploaded service image URL is required" });
          return;
        }
        updates.image = image.trim();
        hasContentEdit = true;
      }

      if (basePrice !== undefined) {
        const parsedPrice = Number(basePrice);
        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
          res
            .status(400)
            .json({ message: "Base price must be a positive number" });
          return;
        }
        updates.basePrice = Math.round(parsedPrice * 100) / 100;
        hasContentEdit = true;
      }

      if (estimatedDuration !== undefined) {
        if (
          typeof estimatedDuration !== "string" ||
          estimatedDuration.trim().length === 0
        ) {
          res.status(400).json({ message: "Estimated duration is required" });
          return;
        }
        updates.estimatedDuration = estimatedDuration.trim();
        hasContentEdit = true;
      }

      if (serviceMode !== undefined) {
        if (
          typeof serviceMode !== "string" ||
          !ALLOWED_SERVICE_MODES.has(serviceMode)
        ) {
          res.status(400).json({
            message: "Service mode must be 'Home Visit' or 'Shop Drop-off'",
          });
          return;
        }
        updates.serviceMode = serviceMode;
        hasContentEdit = true;
      }

      if (serviceArea !== undefined) {
        if (typeof serviceArea !== "string" || serviceArea.trim().length < 2) {
          res.status(400).json({ message: "Service area is required" });
          return;
        }
        updates.serviceArea = serviceArea.trim();
        hasContentEdit = true;
      }

      if (isAvailable !== undefined) {
        if (typeof isAvailable !== "boolean") {
          res.status(400).json({ message: "isAvailable must be a boolean" });
          return;
        }
        updates.isAvailable = isAvailable;
      }

      if (!hasContentEdit && isAvailable === undefined) {
        res.status(400).json({ message: "No valid fields provided to update" });
        return;
      }

      // Requirement: Editing service content resets approvalStatus back to 'pending'
      if (hasContentEdit) {
        updates.approvalStatus = "pending";
      }

      await servicesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updates }
      );

      res.status(200).json({
        message: hasContentEdit
          ? "Service updated and sent back for admin approval"
          : "Service availability updated",
        service: {
          ...existing,
          ...updates,
          _id: id,
        },
      });
    } catch (error) {
      console.error("Error updating service:", error);
      res.status(500).json({ message: "Failed to update service" });
    }
  }
);

// DELETE /api/services/:id — Delete a service owned by the logged-in technician
router.delete(
  "/:id",
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? "");
      if (!ObjectId.isValid(id)) {
        res.status(404).json({ message: "Service not found" });
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

      if (existing.technicianEmail !== req.user!.email) {
        res.status(403).json({
          message: "Forbidden: You can only delete your own services",
        });
        return;
      }

      await servicesCollection.deleteOne({ _id: new ObjectId(id) });

      res.status(200).json({
        message: "Service deleted successfully",
        deletedId: id,
      });
    } catch (error) {
      console.error("Error deleting service:", error);
      res.status(500).json({ message: "Failed to delete service" });
    }
  }
);

// ============================================================================
// PUBLIC SINGLE SERVICE DETAILS (Kept after /my so /my is never swallowed)
// ============================================================================

// GET /api/services/:id — Single public service details + technician profile + customer reviews
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!ObjectId.isValid(id)) {
      res.status(404).json({ message: "Service not found" });
      return;
    }

    const { servicesCollection, usersCollection, bookingsCollection } =
      getCollections();

    const service = await servicesCollection.findOne({
      _id: new ObjectId(id),
      approvalStatus: "approved",
      isAvailable: true,
    });

    if (!service) {
      res.status(404).json({ message: "Service not found" });
      return;
    }

    const [techUser, reviewedBookings] = await Promise.all([
      usersCollection.findOne(
        { email: service.technicianEmail },
        {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            area: 1,
            bio: 1,
            plan: 1,
          },
        }
      ),
      bookingsCollection
        .find(
          {
            serviceId: id,
            rating: { $gte: 1, $lte: 5 },
          },
          {
            projection: {
              customerName: 1,
              rating: 1,
              review: 1,
              reviewComment: 1,
              updatedAt: 1,
              createdAt: 1,
            },
          }
        )
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(20)
        .toArray(),
    ]);

    const reviewCount = reviewedBookings.length;
    const averageRating =
      reviewCount > 0
        ? Math.round(
            (reviewedBookings.reduce(
              (sum, item) => sum + (Number(item.rating) || 0),
              0
            ) /
              reviewCount) *
              10
          ) / 10
        : 0;

    res.status(200).json({
      service: {
        ...service,
        _id: service._id.toString(),
        averageRating,
        reviewCount,
      },
      technician: {
        name: techUser?.name || service.technicianName,
        email: service.technicianEmail,
        image: techUser?.image || "",
        area: techUser?.area || service.serviceArea || "",
        bio: techUser?.bio || "",
        plan: techUser?.plan === "pro" ? "pro" : "free",
      },
      reviews: reviewedBookings.map((item) => ({
        _id: item._id.toString(),
        customerName: item.customerName || "Verified Customer",
        rating: Number(item.rating),
        reviewComment:
          typeof item.reviewComment === "string"
            ? item.reviewComment
            : typeof item.review === "string"
              ? item.review
              : "",
        createdAt: item.updatedAt || item.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching service details:", error);
    res.status(500).json({ message: "Failed to fetch service details" });
  }
});

export default router;