const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const auth = require("../server/middleware/auth");
const Movie = require("../models/Movie");
const User = require("../models/User");
const { enqueue } = require("../server/queue");
const { processMovieUpload } = require("../server/videoPipeline");
const {
  isR2Enabled,
  uploadLocalFile,
  getObjectStream,
  deleteObject,
  deletePrefix,
  contentTypeFromKey
} = require("../server/r2");

const router = express.Router();

const moviesDir = path.join(__dirname, "..", "movies");
const headersDir = path.join(__dirname, "..", "public", "headers", "movies");
const uploadsDir = path.join(moviesDir, "_uploads");
if (!fs.existsSync(moviesDir)) {
  fs.mkdirSync(moviesDir, { recursive: true });
}
if (!fs.existsSync(headersDir)) {
  fs.mkdirSync(headersDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
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

function isAllowedFile(fileName) {
  return allowedExtensions.has(path.extname(fileName).toLowerCase());
}

function getMovieFolder(movieId) {
  return path.join(moviesDir, String(movieId));
}

function getCompressedLocalPath(movie) {
  if (movie.filePath) {
    return path.join(moviesDir, movie.filePath);
  }
  return path.join(getMovieFolder(movie._id), "compressed.mp4");
}

function getCompressedKey(movie) {
  return movie.compressedKey || movie.storageKey || `movies/${movie._id}/compressed.mp4`;
}

function getHlsKey(movie, fileName) {
  if (fileName === "master.m3u8" && movie.hlsKey) {
    return movie.hlsKey;
  }
  return `movies/${movie._id}/${fileName}`;
}

async function streamR2Key({ key, req, res, contentDisposition }) {
  const range = req.headers.range;
  const object = await getObjectStream({ key, range });
  const contentType = object.ContentType || contentTypeFromKey(key) || "application/octet-stream";

  const headers = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes"
  };

  if (object.ContentRange) {
    headers["Content-Range"] = object.ContentRange;
  }
  if (object.ContentLength != null) {
    headers["Content-Length"] = object.ContentLength;
  }
  if (contentDisposition) {
    headers["Content-Disposition"] = contentDisposition;
  }

  res.writeHead(object.ContentRange ? 206 : 200, headers);
  object.Body.pipe(res);
}

function streamLocalFile({ filePath, req, res, contentType, contentDisposition }) {
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: "File missing on server" });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType || "application/octet-stream",
      ...(contentDisposition ? { "Content-Disposition": contentDisposition } : {})
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Length": fileSize,
    "Content-Type": contentType || "application/octet-stream",
    "Accept-Ranges": "bytes",
    ...(contentDisposition ? { "Content-Disposition": contentDisposition } : {})
  });
  fs.createReadStream(filePath).pipe(res);
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
    if (movie.processingStatus && movie.processingStatus !== "ready") {
      if (movie.processingStatus === "failed") {
        return res.status(500).json({
          status: movie.processingStatus,
          message: movie.processingError || "Processing failed"
        });
      }
      return res.status(202).json({ status: movie.processingStatus });
    }

    const manifest = "master.m3u8";
    if (isR2Enabled() && movie.storageProvider === "r2") {
      const key = getHlsKey(movie, manifest);
      return await streamR2Key({ key, req, res });
    }

    const localPath = path.join(getMovieFolder(movie._id), manifest);
    return streamLocalFile({
      filePath: localPath,
      req,
      res,
      contentType: contentTypeFromKey(manifest)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to stream movie" });
  }
});

router.get("/:id/hls", async (req, res) => {
  return res.redirect(`/api/movies/${req.params.id}/hls/master.m3u8`);
});

router.get("/:id/hls/*", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    if (movie.processingStatus && movie.processingStatus !== "ready") {
      if (movie.processingStatus === "failed") {
        return res.status(500).json({
          status: movie.processingStatus,
          message: movie.processingError || "Processing failed"
        });
      }
      return res.status(202).json({ status: movie.processingStatus });
    }

    const fileName = req.params[0];
    if (!fileName) {
      return res.status(400).json({ message: "file is required" });
    }

    if (isR2Enabled() && movie.storageProvider === "r2") {
      const key = getHlsKey(movie, fileName);
      return await streamR2Key({ key, req, res });
    }

    const localPath = path.join(getMovieFolder(movie._id), fileName);
    return streamLocalFile({
      filePath: localPath,
      req,
      res,
      contentType: contentTypeFromKey(fileName)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "HLS failed" });
  }
});

router.get("/:id/thumbnail", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }
    if (movie.processingStatus && movie.processingStatus !== "ready") {
      if (movie.processingStatus === "failed") {
        return res.status(500).json({
          status: movie.processingStatus,
          message: movie.processingError || "Processing failed"
        });
      }
      return res.status(202).json({ status: movie.processingStatus });
    }

    const fileName = "thumbnail.jpg";
    if (isR2Enabled() && movie.storageProvider === "r2") {
      const key = `movies/${movie._id}/${fileName}`;
      return await streamR2Key({ key, req, res });
    }

    const localPath = path.join(getMovieFolder(movie._id), fileName);
    return streamLocalFile({
      filePath: localPath,
      req,
      res,
      contentType: contentTypeFromKey(fileName)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load thumbnail" });
  }
});

router.get("/:id/download", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }
    if (movie.processingStatus && movie.processingStatus !== "ready") {
      if (movie.processingStatus === "failed") {
        return res.status(500).json({
          status: movie.processingStatus,
          message: movie.processingError || "Processing failed"
        });
      }
      return res.status(202).json({ status: movie.processingStatus });
    }

    const downloadName = `${movie.title || "movie"}.mp4`;
    const disposition = `attachment; filename="${downloadName.replace(/"/g, "")}"`;

    if (isR2Enabled() && movie.storageProvider === "r2") {
      const key = getCompressedKey(movie);
      return await streamR2Key({ key, req, res, contentDisposition: disposition });
    }

    const localPath = getCompressedLocalPath(movie);
    return streamLocalFile({
      filePath: localPath,
      req,
      res,
      contentType: contentTypeFromKey("compressed.mp4"),
      contentDisposition: disposition
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to download movie" });
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

    const movie = await Movie.create({
      title,
      uploader: req.user.id,
      views: 0,
      fileSize: req.file.size,
      fileName: req.file.originalname,
      filePath: null,
      storageProvider: isR2Enabled() ? "r2" : "local",
      processingStatus: "processing",
      processingError: ""
    });

    await User.findByIdAndUpdate(req.user.id, { $push: { uploadedMovies: movie._id } });

    enqueue(() =>
      processMovieUpload({
        movieId: movie._id,
        inputPath: req.file.path,
        torrentClient: req.app.locals.torrentClient,
        trackers: req.app.locals.trackers
      })
    )
      .catch((err) => {
        console.error("Movie processing failed:", err);
      });

    return res.json(movie);
  } catch (err) {
    console.error("Movie upload failed:", err);
    return res.status(500).json({ message: err.message || "Upload failed" });
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
      const normalized = movie.headerImage.replace(/^\//, "");
      const oldPath = path.join(__dirname, "..", "public", normalized);
      safeUnlink(oldPath);
      if (isR2Enabled() && normalized.startsWith("headers/")) {
        deleteObject({ key: normalized }).catch(() => {});
      }
    }

    if (isR2Enabled()) {
      const key = `headers/movies/${req.file.filename}`;
      await uploadLocalFile({
        key,
        filePath: req.file.path,
        contentType: contentTypeFromKey(key)
      });
      safeUnlink(req.file.path);
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

    if (movie.storageProvider === "r2" && isR2Enabled()) {
      try {
        await deletePrefix({ prefix: `movies/${movie._id}/` });
      } catch (err) {
        // Ignore R2 delete errors so DB cleanup still happens
      }
    } else {
      const movieFolder = getMovieFolder(movie._id);
      if (fs.existsSync(movieFolder)) {
        try {
          fs.rmSync(movieFolder, { recursive: true, force: true });
        } catch (err) {
          // Ignore file delete errors so DB cleanup still happens
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
    }

    await Movie.findByIdAndDelete(req.params.id);
    await User.findByIdAndUpdate(req.user.id, { $pull: { uploadedMovies: movie._id } });

    return res.json({ message: "Movie deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;
