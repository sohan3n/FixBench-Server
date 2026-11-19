import { Request, Response, Router } from "express";
import { getCollections } from "../config/db.js";
import { verifyToken } from "../middlewares/auth.js";

const router = Router();

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
      name?: string;
      phone?: string;
      area?: string;
      bio?: string;
      image?: string;
    };

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (typeof name === "string" && name.trim().length >= 2) {
      updates.name = name.trim();
    }
    if (typeof phone === "string") {
      updates.phone = phone.trim();
    }
    if (typeof area === "string") {
      updates.area = area.trim();
    }
    if (typeof bio === "string") {
      updates.bio = bio.trim();
    }
    if (typeof image === "string" && image.trim().length > 0) {
      updates.image = image.trim();
    }

    const { usersCollection } = getCollections();
    await usersCollection.updateOne(
      { email: req.user!.email },
      { $set: updates }
    );

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