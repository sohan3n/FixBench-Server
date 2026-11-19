import { Request, Response, Router } from "express";
import { getCollections } from "../config/db.js";
import { verifyToken } from "../middlewares/auth.js";

const router = Router();

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// GET /api/users/me — Returns live profile of the authenticated user
router.get("/me", verifyToken, async (req: Request, res: Response) => {
  try {
    const { usersCollection } = getCollections();
    const user = await usersCollection.findOne({ email: req.user!.email });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.status(200).json({
      _id: user._id?.toString(),
      name: user.name,
      email: user.email,
      image: user.image || "",
      role: user.role || "customer",
      phone: user.phone || "",
      area: user.area || "",
      bio: user.bio || "",
      plan: user.plan || "free",
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error("Error fetching current user:", error);
    res.status(500).json({ message: "Failed to fetch user profile" });
  }
});

// PATCH /api/users/profile — Update profile fields (name, phone, area, bio, image)
router.patch("/profile", verifyToken, async (req: Request, res: Response) => {
  try {
    const { name, phone, area, bio, image } = req.body as {
      name?: unknown;
      phone?: unknown;
      area?: unknown;
      bio?: unknown;
      image?: unknown;
    };

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    let updatedName: string | null = null;

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) {
        res
          .status(400)
          .json({ message: "Name must be at least 2 characters long" });
        return;
      }
      updatedName = name.trim();
      updates.name = updatedName;
    }

    if (phone !== undefined) {
      if (typeof phone !== "string") {
        res.status(400).json({ message: "Invalid phone number format" });
        return;
      }
      updates.phone = phone.trim();
    }

    if (area !== undefined) {
      if (typeof area !== "string") {
        res.status(400).json({ message: "Invalid area format" });
        return;
      }
      updates.area = area.trim();
    }

    if (bio !== undefined) {
      if (typeof bio !== "string") {
        res.status(400).json({ message: "Invalid bio format" });
        return;
      }
      updates.bio = bio.trim();
    }

    if (image !== undefined) {
      if (typeof image !== "string") {
        res.status(400).json({ message: "Invalid image URL format" });
        return;
      }
      const trimmedImage = image.trim();
      if (trimmedImage.length > 0 && !isValidHttpUrl(trimmedImage)) {
        res
          .status(400)
          .json({ message: "Profile image must be a valid HTTP/HTTPS URL" });
        return;
      }
      updates.image = trimmedImage;
    }

    const { usersCollection, servicesCollection } = getCollections();
    await usersCollection.updateOne(
      { email: req.user!.email },
      { $set: updates }
    );

    // Keep technicianName consistent across public service cards if a technician updates their name
    if (updatedName && req.user!.role === "technician") {
      await servicesCollection.updateMany(
        { technicianEmail: req.user!.email },
        { $set: { technicianName: updatedName } }
      );
    }

    const updatedUser = await usersCollection.findOne({
      email: req.user!.email,
    });

    res.status(200).json({
      message: "Profile updated successfully",
      user: {
        _id: updatedUser?._id?.toString(),
        name: updatedUser?.name,
        email: updatedUser?.email,
        image: updatedUser?.image || "",
        role: updatedUser?.role || "customer",
        phone: updatedUser?.phone || "",
        area: updatedUser?.area || "",
        bio: updatedUser?.bio || "",
        plan: updatedUser?.plan || "free",
      },
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

export default router;