const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const auth = require("../server/middleware/auth");
const Movie = require("../models/Movie");
const User = require("../models/User");
const { transcodeToMp4 } = require("../server/transcode");
const { transcodeToHls } = require("../server/hls");

const router = express.Router();

const moviesDir = path.join(__dirname, "..", "movies");
const headersDir = path.join(__dirname, "..", "public", "headers", "movies");
if (!fs.existsSync(moviesDir)) {
  fs.mkdirSync(moviesDir, { recursive: true });
}
if (!fs.existsSync(headersDir)) {
  fs.mkdirSync(headersDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, moviesDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

const headerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, headersDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${req.user.id}_${Date.now()}_${safeName}`);
  }
});

const headerUpload = multer({
  storage: headerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const lower = String(file.originalname || "").toLowerCase();
    if (!/\.(png|jpe?g|webp|gif)$/.test(lower)) {
      return cb(new Error("Header image must be JPG, PNG, WebP, or GIF."));
    }
    return cb(null, true);
  }
});

const allowedExtensions = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".wmv",
  ".ts"
]);
const playableExtensions = new Set([".mp4", ".webm", ".mov"]);
const transcodeLocks = new Map();
const hlsLocks = new Map();

function getLiveMap(req) {
  if (!req.app.locals.liveViews) {
    req.app.locals.liveViews = new Map();
  }
  return req.app.locals.liveViews;
}

function cleanupLive(map) {
  const now = Date.now();
  for (const [movieId, viewers] of map.entries()) {
    for (const [viewerId, lastSeen] of viewers.entries()) {
      if (now - lastSeen > 45000) {
        viewers.delete(viewerId);
      }
    }
    if (!viewers.size) {
      map.delete(movieId);
    }
  }
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

function isPlayableFile(fileName) {
  return playableExtensions.has(path.extname(fileName).toLowerCase());
}

function isAllowedFile(fileName) {
  return allowedExtensions.has(path.extname(fileName).toLowerCase());
}

function seedFile(client, filePath, trackers) {
  return new Promise((resolve, reject) => {
    try {
      client.seed(filePath, { announce: trackers }, (torrent) => resolve(torrent));
    } catch (err) {
      reject(err);
    }
  });
}

router.get("/", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const filter = q ? { title: { $regex: q, $options: "i" } } : {};

    const movies = await Movie.find(filter)
      .populate("uploader", "username")
      .sort({ uploadDate: -1 });

    return res.json(movies);
  } catch (err) {
    return res.status(500).json({ message: "Failed to load movies" });
  }
});

router.get("/:id/stream", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    let relativePath = movie.filePath || movie.fileName;
    const filePath = relativePath ? path.join(moviesDir, relativePath) : null;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File missing on server" });
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".mkv") {
      let lock = transcodeLocks.get(filePath);
      if (!lock) {
        lock = (async () => {
          const outputPath = await transcodeToMp4(filePath);
          try {
            fs.unlinkSync(filePath);
          } catch (err) {
            // ignore cleanup errors
          }
          return outputPath;
        })();
        transcodeLocks.set(filePath, lock);
        lock.finally(() => transcodeLocks.delete(filePath));
      }

      try {
        const outputPath = await lock;
        relativePath = path.relative(moviesDir, outputPath);
        const newFileName = path.basename(outputPath);
        const newSize = fs.statSync(outputPath).size;

        const client = req.app.locals.torrentClient;
        const trackers = req.app.locals.trackers;
        let magnetLink = movie.magnetLink;
        if (client) {
          const torrent = await new Promise((resolve, reject) => {
            try {
              client.seed(outputPath, { announce: trackers }, (t) => resolve(t));
            } catch (err) {
              reject(err);
            }
          });
          magnetLink = torrent.magnetURI;
        }

        if (typeof movie.save === "function") {
          movie.filePath = relativePath;
          movie.fileName = newFileName;
          movie.fileSize = newSize;
          movie.magnetLink = magnetLink;
          await movie.save();
        } else {
          await Movie.findByIdAndUpdate(
            req.params.id,
            {
              filePath: relativePath,
              fileName: newFileName,
              fileSize: newSize,
              magnetLink
            },
            { new: true }
          );
        }
      } catch (err) {
        return res.status(500).json({ message: err.message || "Transcoding failed" });
      }
    }

    const resolvedPath = path.join(moviesDir, relativePath);
    const stat = fs.statSync(resolvedPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const contentTypes = {
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mkv": "video/x-matroska",
      ".mov": "video/quicktime"
    };
    const contentType = contentTypes[path.extname(resolvedPath).toLowerCase()] || "video/mp4";

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType
      });

      const stream = fs.createReadStream(resolvedPath, { start, end });
      stream.pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(resolvedPath).pipe(res);
  } catch (err) {
    return res.status(500).json({ message: "Failed to stream movie" });
  }
});

router.get("/:id/hls", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const relativePath = movie.filePath || movie.fileName;
    const filePath = relativePath ? path.join(moviesDir, relativePath) : null;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File missing on server" });
    }

    const lowData = req.query.low === "1";
    const variant = lowData ? "low" : "standard";
    const hlsDir = path.join(moviesDir, "_hls", movie._id, variant);
    const hlsIndex = path.join(hlsDir, "index.m3u8");

    if (fs.existsSync(hlsIndex)) {
      return res.sendFile(hlsIndex);
    }

    let lock = hlsLocks.get(hlsDir);
    if (!lock) {
      lock = (async () => {
        await transcodeToHls(filePath, hlsDir, { lowData });
        return hlsIndex;
      })();
      hlsLocks.set(hlsDir, lock);
      lock.finally(() => hlsLocks.delete(hlsDir));
    }

    const wait = req.query.wait === "1";
    if (!wait) {
      return res.status(202).json({ message: "Transcoding to HLS" });
    }

    const indexPath = await lock;
    return res.sendFile(indexPath);
  } catch (err) {
    return res.status(500).json({ message: err.message || "HLS failed" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id).populate("uploader", "username");
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }
    return res.json(movie);
  } catch (err) {
    return res.status(500).json({ message: "Failed to load movie" });
  }
});

router.get("/:id/ratings", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }
    const ratings = Array.isArray(movie.ratings) ? movie.ratings : [];
    const sorted = ratings
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const userIds = [...new Set(sorted.map((item) => String(item.userId || "")))].filter(Boolean);
    let users = [];
    if (userIds.length) {
      users = await User.find({ _id: { $in: userIds } });
    }
    const userMap = new Map((users || []).map((user) => [String(user._id), user]));
    const enriched = sorted.map((item) => {
      const user = userMap.get(String(item.userId || ""));
      return {
        userId: item.userId,
        score: item.score,
        comment: item.comment,
        createdAt: item.createdAt,
        user: user
          ? { id: user._id, username: user.username, avatarUrl: user.avatarUrl || "" }
          : null
      };
    });
    return res.json({
      ratingAverage: movie.ratingAverage || 0,
      ratingCount: movie.ratingCount || ratings.length,
      ratings: enriched.slice(0, 20)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load ratings" });
  }
});

router.get("/:id/live", async (req, res) => {
  const map = getLiveMap(req);
  cleanupLive(map);
  const viewers = map.get(String(req.params.id));
  return res.json({ count: viewers ? viewers.size : 0 });
});

router.post("/:id/live", async (req, res) => {
  try {
    const viewerId = String(req.body.viewerId || "").trim();
    if (!viewerId) {
      return res.status(400).json({ message: "viewerId is required" });
    }
    const map = getLiveMap(req);
    cleanupLive(map);
    const movieKey = String(req.params.id);
    const viewers = map.get(movieKey) || new Map();
    viewers.set(viewerId, Date.now());
    map.set(movieKey, viewers);
    return res.json({ count: viewers.size });
  } catch (err) {
    return res.status(500).json({ message: "Failed to update live viewers" });
  }
});

router.post("/:id/ratings", auth, async (req, res) => {
  try {
    const score = Number(req.body.score || 0);
    const comment = String(req.body.comment || "").trim();
    if (!Number.isFinite(score) || score < 1 || score > 5) {
      return res.status(400).json({ message: "Score must be between 1 and 5" });
    }

    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const ratings = Array.isArray(movie.ratings) ? movie.ratings : [];
    const existing = ratings.find((entry) => String(entry.userId) === String(req.user.id));
    const now = new Date().toISOString();

    if (existing) {
      existing.score = score;
      existing.comment = comment.slice(0, 500);
      existing.createdAt = now;
    } else {
      ratings.push({
        userId: req.user.id,
        score,
        comment: comment.slice(0, 500),
        createdAt: now
      });
    }

    const total = ratings.reduce((sum, item) => sum + Number(item.score || 0), 0);
    const avg = ratings.length ? total / ratings.length : 0;

    if (typeof movie.save === "function") {
      movie.ratings = ratings;
      movie.ratingAverage = avg;
      movie.ratingCount = ratings.length;
      await movie.save();
    } else {
      await Movie.findByIdAndUpdate(
        req.params.id,
        { ratings, ratingAverage: avg, ratingCount: ratings.length },
        { new: true }
      );
    }

    return res.json({ ratingAverage: avg, ratingCount: ratings.length });
  } catch (err) {
    return res.status(500).json({ message: "Failed to save rating" });
  }
});

router.post("/:id/view", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const now = new Date();
    const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    const history = Array.isArray(movie.viewHistory) ? movie.viewHistory : [];
    const existing = history.find((entry) => entry.date === dayKey);
    if (existing) {
      existing.count = (existing.count || 0) + 1;
    } else {
      history.push({ date: dayKey, count: 1 });
    }

    const nextViews = (movie.views || 0) + 1;

    if (typeof movie.save === "function") {
      movie.views = nextViews;
      movie.viewHistory = history;
      await movie.save();
      return res.json({ views: movie.views });
    }

    const updated = await Movie.findByIdAndUpdate(
      req.params.id,
      { views: nextViews, viewHistory: history },
      { new: true }
    );

    return res.json({ views: updated ? updated.views : nextViews });
  } catch (err) {
    return res.status(500).json({ message: "Failed to record view" });
  }
});

router.post("/upload", auth, upload.single("video"), async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !req.file) {
      return res.status(400).json({ message: "title and video are required" });
    }

    if (!isAllowedFile(req.file.originalname)) {
      safeUnlink(req.file.path);
      return res
        .status(400)
        .json({
          message:
            "Unsupported format. Use MP4, WebM, MOV, MKV, AVI, M4V, MPG, MPEG, WMV, or TS."
        });
    }

    let finalPath = req.file.path;
    let finalName = req.file.filename;
    let finalSize = req.file.size;

    if (!isPlayableFile(req.file.originalname)) {
      try {
        finalPath = await transcodeToMp4(req.file.path);
        finalName = path.basename(finalPath);
        finalSize = fs.statSync(finalPath).size;
        safeUnlink(req.file.path);
      } catch (err) {
        return res.status(500).json({ message: err.message || "Transcoding failed" });
      }
    }

    const client = req.app.locals.torrentClient;
    const trackers = req.app.locals.trackers;

    const torrent = await seedFile(client, finalPath, trackers);

    const movie = await Movie.create({
      title,
      uploader: req.user.id,
      magnetLink: torrent.magnetURI,
      views: 0,
      fileSize: finalSize,
      fileName: finalName,
      filePath: path.relative(moviesDir, finalPath)
    });

    await User.findByIdAndUpdate(req.user.id, { $push: { uploadedMovies: movie._id } });

    return res.json(movie);
  } catch (err) {
    return res.status(500).json({ message: "Upload failed" });
  }
});

router.put("/:id/header", auth, headerUpload.single("header"), async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }
    if (String(movie.uploader) !== String(req.user.id)) {
      return res.status(403).json({ message: "Not allowed to update this movie" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "header image is required" });
    }

    if (movie.headerImage) {
      const oldPath = path.join(
        __dirname,
        "..",
        "public",
        movie.headerImage.replace(/^\//, "")
      );
      safeUnlink(oldPath);
    }

    const nextHeader = `/headers/movies/${req.file.filename}`;
    if (typeof movie.save === "function") {
      movie.headerImage = nextHeader;
      await movie.save();
      return res.json(movie);
    }

    const updated = await Movie.findByIdAndUpdate(
      req.params.id,
      { headerImage: nextHeader },
      { new: true }
    );
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ message: "Failed to update movie header" });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    if (String(movie.uploader) !== String(req.user.id)) {
      return res.status(403).json({ message: "Not allowed to delete this movie" });
    }

    const client = req.app.locals.torrentClient;
    if (client && movie.magnetLink) {
      const torrent = client.get(movie.magnetLink);
      if (torrent) {
        try {
          torrent.destroy();
        } catch (err) {
          // Ignore torrent cleanup errors
        }
      }
    }

    const relativePath = movie.filePath || movie.fileName;
    if (relativePath) {
      const filePath = path.join(moviesDir, relativePath);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          // Ignore file delete errors so DB cleanup still happens
        }
      }
    }

    await Movie.findByIdAndDelete(req.params.id);
    await User.findByIdAndUpdate(req.user.id, { $pull: { uploadedMovies: movie._id } });

    return res.json({ message: "Movie deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;
