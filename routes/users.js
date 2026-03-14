const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const auth = require("../server/middleware/auth");
const User = require("../models/User");
const {
  isR2Enabled,
  uploadLocalFile,
  contentTypeFromKey,
  deleteObject
} = require("../server/r2");

const router = express.Router();

const avatarsDir = path.join(__dirname, "..", "public", "avatars");
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

function safeUnlink(targetPath) {
  if (!targetPath) return;
  if (!fs.existsSync(targetPath)) return;
  try {
    fs.unlinkSync(targetPath);
  } catch (err) {
    // Ignore cleanup errors
  }
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
      bio: user.bio || "",
      uploadedMovies: user.uploadedMovies || [],
      followersCount: Array.isArray(user.followers) ? user.followers.length : 0,
      followingCount: Array.isArray(user.following) ? user.following.length : 0,
      watchlistCount: Array.isArray(user.watchlist) ? user.watchlist.length : 0,
      followingIds: Array.isArray(user.following) ? user.following : [],
      watchlistIds: Array.isArray(user.watchlist) ? user.watchlist : []
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load profile" });
  }
});

router.put("/me", auth, avatarUpload.single("avatar"), async (req, res) => {
  try {
    const updates = {};
    const username = String(req.body.username || "").trim();
    const bioRaw = req.body.bio;

    if (username) {
      const existing = await User.findOne({ username });
      if (existing && String(existing._id) !== String(req.user.id)) {
        return res.status(409).json({ message: "Username already taken" });
      }
      updates.username = username;
    }

    if (req.file) {
      if (isR2Enabled()) {
        const key = `avatars/${req.file.filename}`;
        await uploadLocalFile({
          key,
          filePath: req.file.path,
          contentType: contentTypeFromKey(key)
        });
        safeUnlink(req.file.path);
      }
      updates.avatarUrl = `/avatars/${req.file.filename}`;
    }

    if (bioRaw !== undefined) {
      updates.bio = String(bioRaw || "").trim().slice(0, 280);
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: "No profile updates provided" });
    }

    const previous = await User.findById(req.user.id);
    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (
      isR2Enabled() &&
      updates.avatarUrl &&
      previous &&
      previous.avatarUrl &&
      previous.avatarUrl !== updates.avatarUrl
    ) {
      const normalized = String(previous.avatarUrl).replace(/^\//, "");
      if (normalized.startsWith("avatars/")) {
        deleteObject({ key: normalized }).catch(() => {});
      }
    }

    return res.json({
      id: user._id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl || "",
      bio: user.bio || ""
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update profile" });
  }
});

function normalizeUserLists(user) {
  if (!user) return user;
  if (!Array.isArray(user.watchlist)) user.watchlist = [];
  if (!Array.isArray(user.watchHistory)) user.watchHistory = [];
  if (!Array.isArray(user.followers)) user.followers = [];
  if (!Array.isArray(user.following)) user.following = [];
  return user;
}

function buildPublicUser(user) {
  return {
    id: user._id,
    username: user.username,
    avatarUrl: user.avatarUrl || "",
    bio: user.bio || "",
    followersCount: Array.isArray(user.followers) ? user.followers.length : 0,
    followingCount: Array.isArray(user.following) ? user.following.length : 0,
    uploadsCount: Array.isArray(user.uploadedMovies) ? user.uploadedMovies.length : 0
  };
}

router.get("/", async (req, res) => {
  try {
    const users = await User.find({});
    const list = (users || []).map((user) => buildPublicUser(normalizeUserLists(user)));
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: "Failed to load users" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const user = normalizeUserLists(await User.findById(req.params.id));
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let uploads = [];
    if (Array.isArray(user.uploadedMovies) && user.uploadedMovies.length) {
      uploads = await User.findById(user._id)
        .populate({
          path: "uploadedMovies",
          select: "title uploadDate views fileSize headerImage ratingAverage ratingCount"
        })
        .then((doc) => doc.uploadedMovies || [])
        .catch(() => []);
    }

    return res.json({
      ...buildPublicUser(user),
      uploadedMovies: uploads || []
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load profile" });
  }
});

router.post("/:id/follow", auth, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    const target = normalizeUserLists(await User.findById(req.params.id));
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    const me = normalizeUserLists(await User.findById(req.user.id));
    if (!me) {
      return res.status(404).json({ message: "User not found" });
    }

    const already = (me.following || []).some((id) => String(id) === String(target._id));
    if (already) {
      return res.json({ following: true });
    }

    await User.findByIdAndUpdate(req.user.id, { $push: { following: target._id } });
    await User.findByIdAndUpdate(target._id, { $push: { followers: req.user.id } });

    return res.json({ following: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to follow user" });
  }
});

router.delete("/:id/follow", auth, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ message: "You cannot unfollow yourself" });
    }

    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    await User.findByIdAndUpdate(req.user.id, { $pull: { following: target._id } });
    await User.findByIdAndUpdate(target._id, { $pull: { followers: req.user.id } });

    return res.json({ following: false });
  } catch (err) {
    return res.status(500).json({ message: "Failed to unfollow user" });
  }
});

router.get("/me/watchlist", auth, async (req, res) => {
  try {
    const user = normalizeUserLists(await User.findById(req.user.id));
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const ids = (user.watchlist || []).map(String);
    if (!ids.length) return res.json([]);
    const movies = await require("../models/Movie").find({ _id: { $in: ids } });
    return res.json(movies || []);
  } catch (err) {
    return res.status(500).json({ message: "Failed to load watchlist" });
  }
});

router.post("/me/watchlist/:movieId", auth, async (req, res) => {
  try {
    const movieId = req.params.movieId;
    const user = normalizeUserLists(await User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: "User not found" });
    const exists = (user.watchlist || []).some((id) => String(id) === String(movieId));
    if (exists) return res.json({ added: false });
    await User.findByIdAndUpdate(req.user.id, { $push: { watchlist: movieId } });
    return res.json({ added: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update watchlist" });
  }
});

router.delete("/me/watchlist/:movieId", auth, async (req, res) => {
  try {
    const movieId = req.params.movieId;
    await User.findByIdAndUpdate(req.user.id, { $pull: { watchlist: movieId } });
    return res.json({ removed: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update watchlist" });
  }
});

router.get("/me/history", auth, async (req, res) => {
  try {
    const user = normalizeUserLists(await User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: "User not found" });
    const history = Array.isArray(user.watchHistory) ? user.watchHistory : [];
    const ids = history.map((item) => item.movieId).filter(Boolean);
    if (!ids.length) return res.json([]);
    const movies = await require("../models/Movie").find({ _id: { $in: ids } });
    const movieMap = new Map((movies || []).map((movie) => [String(movie._id), movie]));
    const entries = history
      .map((item) => {
        const movie = movieMap.get(String(item.movieId));
        if (!movie) return null;
        return { ...item, movie };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return res.json(entries);
  } catch (err) {
    return res.status(500).json({ message: "Failed to load history" });
  }
});

router.get("/me/history/:movieId", auth, async (req, res) => {
  try {
    const user = normalizeUserLists(await User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: "User not found" });
    const history = Array.isArray(user.watchHistory) ? user.watchHistory : [];
    const entry = history.find((item) => String(item.movieId) === String(req.params.movieId));
    return res.json(entry || null);
  } catch (err) {
    return res.status(500).json({ message: "Failed to load history" });
  }
});

router.put("/me/history", auth, async (req, res) => {
  try {
    const { movieId, position, duration } = req.body || {};
    if (!movieId) {
      return res.status(400).json({ message: "movieId is required" });
    }
    const safePosition = Math.max(0, Number(position) || 0);
    const safeDuration = Math.max(0, Number(duration) || 0);
    const progress = safeDuration ? Math.min(1, safePosition / safeDuration) : 0;
    const user = normalizeUserLists(await User.findById(req.user.id));
    if (!user) return res.status(404).json({ message: "User not found" });
    const history = Array.isArray(user.watchHistory) ? user.watchHistory : [];
    const existing = history.find((item) => String(item.movieId) === String(movieId));
    const now = new Date().toISOString();
    if (existing) {
      existing.lastPosition = safePosition;
      existing.duration = safeDuration;
      existing.progress = progress;
      existing.updatedAt = now;
    } else {
      history.push({
        movieId,
        lastPosition: safePosition,
        duration: safeDuration,
        progress,
        updatedAt: now
      });
    }

    await User.findByIdAndUpdate(req.user.id, { watchHistory: history }, { new: true });
    return res.json({ saved: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update history" });
  }
});

module.exports = router;
