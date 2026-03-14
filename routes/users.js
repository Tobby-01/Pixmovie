const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const auth = require("../server/middleware/auth");
const User = require("../models/User");

const router = express.Router();

const avatarsDir = path.join(__dirname, "..", "public", "avatars");
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarsDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${req.user.id}_${Date.now()}_${safeName}`);
  }
});

const avatarUpload = multer({ storage: avatarStorage });

router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate({
      path: "uploadedMovies",
      select: "title uploadDate views fileSize magnetLink"
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      id: user._id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl || "",
      uploadedMovies: user.uploadedMovies || []
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load profile" });
  }
});

router.put("/me", auth, avatarUpload.single("avatar"), async (req, res) => {
  try {
    const updates = {};
    const username = String(req.body.username || "").trim();

    if (username) {
      const existing = await User.findOne({ username });
      if (existing && String(existing._id) !== String(req.user.id)) {
        return res.status(409).json({ message: "Username already taken" });
      }
      updates.username = username;
    }

    if (req.file) {
      updates.avatarUrl = `/avatars/${req.file.filename}`;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: "No profile updates provided" });
    }

    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      id: user._id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl || ""
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update profile" });
  }
});

module.exports = router;
