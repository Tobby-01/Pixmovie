const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const auth = require("../server/middleware/auth");
const Series = require("../models/Series");
const Movie = require("../models/Movie");
const User = require("../models/User");
const { transcodeToMp4 } = require("../server/transcode");

const router = express.Router();

const moviesDir = path.join(__dirname, "..", "movies");
const headersDir = path.join(__dirname, "..", "public", "headers", "series");
if (!fs.existsSync(headersDir)) {
  fs.mkdirSync(headersDir, { recursive: true });
}

function safeName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_");
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

const episodeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const seriesId = req.params.id;
    const seasonNumber = Number(req.body.seasonNumber || 1);
    const seasonDir = path.join(moviesDir, "series", seriesId, `season-${seasonNumber}`);
    fs.mkdirSync(seasonDir, { recursive: true });
    cb(null, seasonDir);
  },
  filename: (req, file, cb) => {
    const safe = safeName(file.originalname);
    cb(null, `${Date.now()}_${safe}`);
  }
});

const episodeUpload = multer({
  storage: episodeStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

const seriesHeaderStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, headersDir),
  filename: (req, file, cb) => {
    const safe = safeName(file.originalname);
    cb(null, `${Date.now()}_series_${safe}`);
  }
});

const seriesHeaderUpload = multer({
  storage: seriesHeaderStorage,
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

function isPlayableFile(fileName) {
  return playableExtensions.has(path.extname(fileName).toLowerCase());
}

function isAllowedFile(fileName) {
  return allowedExtensions.has(path.extname(fileName).toLowerCase());
}

router.post("/", auth, seriesHeaderUpload.single("header"), async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const seasonsCount = Number(req.body.seasonsCount || 0);
    if (!title || !Number.isFinite(seasonsCount) || seasonsCount < 1) {
      return res.status(400).json({ message: "title and seasonsCount are required" });
    }

    const series = await Series.create({
      title,
      seasonsCount,
      uploader: req.user.id,
      headerImage: req.file ? `/headers/series/${req.file.filename}` : null
    });

    return res.json(series);
  } catch (err) {
    return res.status(500).json({ message: "Failed to create series" });
  }
});

router.get("/mine", auth, async (req, res) => {
  try {
    const series = await Series.find({ uploader: req.user.id }).sort({ createdAt: -1 });
    return res.json(series);
  } catch (err) {
    return res.status(500).json({ message: "Failed to load series" });
  }
});

router.put("/:id/header", auth, seriesHeaderUpload.single("header"), async (req, res) => {
  try {
    const series = await Series.findById(req.params.id);
    if (!series) {
      return res.status(404).json({ message: "Series not found" });
    }
    if (String(series.uploader) !== String(req.user.id)) {
      return res.status(403).json({ message: "Not allowed to update this series" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "header image is required" });
    }

    if (series.headerImage) {
      const oldPath = path.join(__dirname, "..", "public", series.headerImage.replace(/^\//, ""));
      safeUnlink(oldPath);
    }

    const nextHeader = `/headers/series/${req.file.filename}`;
    if (typeof series.save === "function") {
      series.headerImage = nextHeader;
      await series.save();
      return res.json(series);
    }

    const updated = await Series.findByIdAndUpdate(
      req.params.id,
      { headerImage: nextHeader },
      { new: true }
    );
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ message: "Failed to update series header" });
  }
});

router.get("/:id/episodes", async (req, res) => {
  try {
    const seriesId = req.params.id;
    const season = req.query.season ? Number(req.query.season) : null;
    const filter = { seriesId };
    if (season) {
      filter.seasonNumber = season;
    }
    const episodes = await Movie.find(filter).sort({ seasonNumber: 1, episodeNumber: 1 });
    return res.json(episodes);
  } catch (err) {
    return res.status(500).json({ message: "Failed to load episodes" });
  }
});

router.post("/:id/episodes", auth, episodeUpload.single("video"), async (req, res) => {
  try {
    const seriesId = req.params.id;
    const series = await Series.findById(seriesId);
    if (!series) {
      return res.status(404).json({ message: "Series not found" });
    }
    if (String(series.uploader) !== String(req.user.id)) {
      return res.status(403).json({ message: "Not allowed to upload to this series" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "video is required" });
    }

    if (!isAllowedFile(req.file.originalname)) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res
        .status(400)
        .json({
          message:
            "Unsupported format. Use MP4, WebM, MOV, MKV, AVI, M4V, MPG, MPEG, WMV, or TS."
        });
    }

    const seasonNumber = Number(req.body.seasonNumber || 1);
    if (!Number.isFinite(seasonNumber) || seasonNumber < 1) {
      return res.status(400).json({ message: "seasonNumber must be a positive number" });
    }

    let episodeNumber = Number(req.body.episodeNumber || 0);
    if (!episodeNumber) {
      const existing = await Movie.find({ seriesId, seasonNumber });
      const max = existing.reduce((acc, item) => Math.max(acc, Number(item.episodeNumber) || 0), 0);
      episodeNumber = max + 1;
    }

    const title = String(req.body.title || "").trim() || `Episode ${episodeNumber}`;
    let finalPath = req.file.path;
    let finalName = req.file.filename;
    let finalSize = req.file.size;

    if (!isPlayableFile(req.file.originalname)) {
      try {
        finalPath = await transcodeToMp4(req.file.path);
        finalName = path.basename(finalPath);
        finalSize = fs.statSync(finalPath).size;
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (err) {
        return res.status(500).json({ message: err.message || "Transcoding failed" });
      }
    }

    const relativePath = path.relative(moviesDir, finalPath);

    const client = req.app.locals.torrentClient;
    const trackers = req.app.locals.trackers;

    const torrent = await new Promise((resolve, reject) => {
      try {
        client.seed(finalPath, { announce: trackers }, (t) => resolve(t));
      } catch (err) {
        reject(err);
      }
    });

    const movie = await Movie.create({
      title,
      uploader: req.user.id,
      magnetLink: torrent.magnetURI,
      views: 0,
      fileSize: finalSize,
      fileName: finalName,
      filePath: relativePath,
      isEpisode: true,
      seriesId,
      seriesTitle: series.title,
      headerImage: series.headerImage || null,
      seasonNumber,
      episodeNumber
    });

    await User.findByIdAndUpdate(req.user.id, { $push: { uploadedMovies: movie._id } });

    return res.json(movie);
  } catch (err) {
    return res.status(500).json({ message: "Episode upload failed" });
  }
});

module.exports = router;
