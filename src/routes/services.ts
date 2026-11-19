// import { Request, Response, Router } from "express";
// import { Filter, Document, ObjectId, Sort } from "mongodb";
// import { getCollections } from "../config/db.js";

// const router = Router();

// const ALLOWED_CATEGORIES = new Set([
//   "Smartphone",
//   "Laptop & PC",
//   "AC",
//   "Refrigerator",
//   "TV",
//   "Washing Machine",
//   "Electrical",
// ]);

// const ALLOWED_SERVICE_MODES = new Set(["Home Visit", "Shop Drop-off"]);

// function escapeRegex(value: string): string {
//   return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// }

// // GET /api/services — Public approved & available services with search, filter, sort & pagination
// router.get("/", async (req: Request, res: Response) => {
//   try {
//     const { servicesCollection, usersCollection, bookingsCollection } =
//       getCollections();

//     const rawSearch =
//       typeof req.query.search === "string" ? req.query.search.trim() : "";
//     const rawCategory =
//       typeof req.query.category === "string" ? req.query.category.trim() : "";
//     const rawMode =
//       typeof req.query.serviceMode === "string"
//         ? req.query.serviceMode.trim()
//         : "";
//     const rawSort =
//       typeof req.query.sort === "string" ? req.query.sort.trim() : "newest";

//     const parsedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
//     const parsedLimit = Number.parseInt(String(req.query.limit ?? "9"), 10);

//     const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
//     const limit =
//       Number.isFinite(parsedLimit) && parsedLimit > 0
//         ? Math.min(parsedLimit, 50)
//         : 9;
//     const skip = (page - 1) * limit;

//     // Mandatory public visibility gate
//     const filter: Filter<Document> = {
//       approvalStatus: "approved",
//       isAvailable: true,
//     };

//     if (rawSearch.length > 0) {
//       const safePattern = new RegExp(escapeRegex(rawSearch), "i");
//       filter.$or = [{ title: safePattern }, { category: safePattern }];
//     }

//     if (rawCategory && rawCategory !== "All" && ALLOWED_CATEGORIES.has(rawCategory)) {
//       filter.category = rawCategory;
//     }

//     if (rawMode && rawMode !== "All" && ALLOWED_SERVICE_MODES.has(rawMode)) {
//       filter.serviceMode = rawMode;
//     }

//     let sortStage: Sort = { createdAt: -1 };
//     if (rawSort === "price_asc") {
//       sortStage = { basePrice: 1, createdAt: -1 };
//     } else if (rawSort === "price_desc") {
//       sortStage = { basePrice: -1, createdAt: -1 };
//     }

//     const [total, rawServices] = await Promise.all([
//       servicesCollection.countDocuments(filter),
//       servicesCollection
//         .find(filter)
//         .sort(sortStage)
//         .skip(skip)
//         .limit(limit)
//         .toArray(),
//     ]);

//     // Batch-enrich cards with technician Pro plan & aggregated booking ratings
//     const serviceIds = rawServices.map((s) => s._id.toString());
//     const technicianEmails = Array.from(
//       new Set(
//         rawServices
//           .map((s) => s.technicianEmail)
//           .filter((email): email is string => typeof email === "string")
//       )
//     );

//     const [technicians, ratingStats] = await Promise.all([
//       technicianEmails.length > 0
//         ? usersCollection
//             .find(
//               { email: { $in: technicianEmails } },
//               { projection: { email: 1, plan: 1, image: 1 } }
//             )
//             .toArray()
//         : Promise.resolve([]),
//       serviceIds.length > 0
//         ? bookingsCollection
//             .aggregate([
//               {
//                 $match: {
//                   serviceId: { $in: serviceIds },
//                   rating: { $gte: 1, $lte: 5 },
//                 },
//               },
//               {
//                 $group: {
//                   _id: "$serviceId",
//                   averageRating: { $avg: "$rating" },
//                   reviewCount: { $sum: 1 },
//                 },
//               },
//             ])
//             .toArray()
//         : Promise.resolve([]),
//     ]);

//     const techPlanMap = new Map<string, string>();
//     for (const tech of technicians) {
//       if (typeof tech.email === "string") {
//         techPlanMap.set(tech.email, tech.plan === "pro" ? "pro" : "free");
//       }
//     }

//     const ratingMap = new Map<
//       string,
//       { averageRating: number; reviewCount: number }
//     >();
//     for (const stat of ratingStats) {
//       if (typeof stat._id === "string") {
//         ratingMap.set(stat._id, {
//           averageRating: Math.round((Number(stat.averageRating) || 0) * 10) / 10,
//           reviewCount: Number(stat.reviewCount) || 0,
//         });
//       }
//     }

//     const services = rawServices.map((service) => {
//       const id = service._id.toString();
//       const ratingInfo = ratingMap.get(id) ?? {
//         averageRating: 0,
//         reviewCount: 0,
//       };

//       return {
//         ...service,
//         _id: id,
//         technicianPlan: techPlanMap.get(service.technicianEmail) ?? "free",
//         averageRating: ratingInfo.averageRating,
//         reviewCount: ratingInfo.reviewCount,
//       };
//     });

//     const totalPages = Math.max(1, Math.ceil(total / limit));

//     res.status(200).json({
//       services,
//       pagination: {
//         total,
//         page,
//         limit,
//         totalPages,
//         hasNextPage: page < totalPages,
//         hasPrevPage: page > 1,
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching public services:", error);
//     res.status(500).json({ message: "Failed to fetch services" });
//   }
// });

// // GET /api/services/:id — Single public service details + technician profile + customer reviews
// router.get("/:id", async (req: Request, res: Response) => {
//   try {
//     const id = String(req.params.id ?? "");
//     if (!ObjectId.isValid(id)) {
//       res.status(404).json({ message: "Service not found" });
//       return;
//     }

//     const { servicesCollection, usersCollection, bookingsCollection } =
//       getCollections();

//     const service = await servicesCollection.findOne({
//       _id: new ObjectId(id),
//       approvalStatus: "approved",
//       isAvailable: true,
//     });

//     if (!service) {
//       res.status(404).json({ message: "Service not found" });
//       return;
//     }

//     const [techUser, reviewedBookings] = await Promise.all([
//       usersCollection.findOne(
//         { email: service.technicianEmail },
//         {
//           projection: {
//             name: 1,
//             email: 1,
//             image: 1,
//             area: 1,
//             bio: 1,
//             plan: 1,
//           },
//         }
//       ),
//       bookingsCollection
//         .find(
//           {
//             serviceId: id,
//             rating: { $gte: 1, $lte: 5 },
//           },
//           {
//             projection: {
//               customerName: 1,
//               rating: 1,
//               review: 1,
//               updatedAt: 1,
//               createdAt: 1,
//             },
//           }
//         )
//         .sort({ updatedAt: -1, createdAt: -1 })
//         .limit(20)
//         .toArray(),
//     ]);

//     const reviewCount = reviewedBookings.length;
//     const averageRating =
//       reviewCount > 0
//         ? Math.round(
//             (reviewedBookings.reduce(
//               (sum, item) => sum + (Number(item.rating) || 0),
//               0
//             ) /
//               reviewCount) *
//               10
//           ) / 10
//         : 0;

//     res.status(200).json({
//       service: {
//         ...service,
//         _id: service._id.toString(),
//         averageRating,
//         reviewCount,
//       },
//       technician: {
//         name: techUser?.name || service.technicianName,
//         email: service.technicianEmail,
//         image: techUser?.image || "",
//         area: techUser?.area || service.serviceArea || "",
//         bio: techUser?.bio || "",
//         plan: techUser?.plan === "pro" ? "pro" : "free",
//       },
//       reviews: reviewedBookings.map((item) => ({
//         _id: item._id.toString(),
//         customerName: item.customerName || "Verified Customer",
//         rating: Number(item.rating),
//         review: typeof item.review === "string" ? item.review : "",
//         createdAt: item.updatedAt || item.createdAt,
//       })),
//     });
//   } catch (error) {
//     console.error("Error fetching service details:", error);
//     res.status(500).json({ message: "Failed to fetch service details" });
//   }
// });

// export default router;