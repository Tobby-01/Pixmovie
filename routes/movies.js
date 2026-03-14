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
if (!fs.existsSync(moviesDir)) {
  fs.mkdirSync(moviesDir, { recursive: true });
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

    const hlsDir = path.join(moviesDir, "_hls", movie._id);
    const hlsIndex = path.join(hlsDir, "index.m3u8");

    if (fs.existsSync(hlsIndex)) {
      return res.sendFile(hlsIndex);
    }

    let lock = hlsLocks.get(hlsDir);
    if (!lock) {
      lock = (async () => {
        await transcodeToHls(filePath, hlsDir);
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
