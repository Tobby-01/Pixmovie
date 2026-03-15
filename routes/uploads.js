const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const auth = require("../server/middleware/auth");
const Movie = require("../models/Movie");
const User = require("../models/User");
const Series = require("../models/Series");
const { enqueue } = require("../server/queue");
const { processMovieUpload } = require("../server/videoPipeline");
const { isR2Enabled } = require("../server/r2");

const router = express.Router();

const uploadsRoot = path.join(__dirname, "..", "movies", "_uploads", "resumable");
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeRemoveDir(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
}

function createUploadId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sessionDir(uploadId) {
  return path.join(uploadsRoot, uploadId);
}

function manifestPath(uploadId) {
  return path.join(sessionDir(uploadId), "manifest.json");
}

function partPath(uploadId) {
  return path.join(sessionDir(uploadId), "upload.part");
}

function readManifest(uploadId) {
  const file = manifestPath(uploadId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
}

function writeManifest(manifest) {
  ensureDir(sessionDir(manifest.uploadId));
  fs.writeFileSync(manifestPath(manifest.uploadId), JSON.stringify(manifest, null, 2));
}

function isAllowedFile(fileName) {
  return allowedExtensions.has(path.extname(fileName).toLowerCase());
}

function parseContentRange(value) {
  if (!value) return null;
  const match = String(value).match(/bytes (\d+)-(\d+)\/(\d+)/);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: Number(match[3])
  };
}

ensureDir(uploadsRoot);

router.post("/init", auth, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const fileName = String(req.body.fileName || "").trim();
    const size = Number(req.body.size || 0);
    const kind = req.body.kind === "episode" ? "episode" : "movie";
    const seriesId = String(req.body.seriesId || "").trim();
    const seasonNumber = Number(req.body.seasonNumber || 0);
    const episodeNumber = Number(req.body.episodeNumber || 0);

    if (!fileName || !Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ message: "fileName and size are required" });
    }
    if (!isAllowedFile(fileName)) {
      return res.status(400).json({
        message: "Unsupported format. Use MP4, WebM, MOV, MKV, AVI, M4V, MPG, MPEG, WMV, or TS."
      });
    }
    if (kind === "movie" && !title) {
      return res.status(400).json({ message: "title is required" });
    }
    if (kind === "episode") {
      if (!seriesId) {
        return res.status(400).json({ message: "seriesId is required" });
      }
      if (!Number.isFinite(seasonNumber) || seasonNumber < 1) {
        return res.status(400).json({ message: "seasonNumber must be a positive number" });
      }
    }

    const uploadId = createUploadId();
    ensureDir(sessionDir(uploadId));
    const manifest = {
      uploadId,
      userId: req.user.id,
      title,
      fileName,
      size,
      kind,
      seriesId,
      seasonNumber,
      episodeNumber,
      received: 0,
      status: "uploading",
      createdAt: new Date().toISOString()
    };
    writeManifest(manifest);

    return res.json({ uploadId, chunkSize: DEFAULT_CHUNK_SIZE, received: 0 });
  } catch (err) {
    return res.status(500).json({ message: "Failed to start upload" });
  }
});

router.get("/:id/status", auth, async (req, res) => {
  const uploadId = req.params.id;
  const manifest = readManifest(uploadId);
  if (!manifest) {
    return res.status(404).json({ message: "Upload not found" });
  }
  if (String(manifest.userId) !== String(req.user.id)) {
    return res.status(403).json({ message: "Not allowed to access this upload" });
  }
  if (manifest.status && manifest.status !== "uploading") {
    return res.status(409).json({ message: "Upload is not accepting chunks anymore" });
  }
  return res.json({
    uploadId,
    received: Number(manifest.received || 0),
    size: Number(manifest.size || 0),
    status: manifest.status || "uploading",
    fileName: manifest.fileName,
    chunkSize: DEFAULT_CHUNK_SIZE
  });
});

router.put("/:id/chunk", auth, async (req, res) => {
  const uploadId = req.params.id;
  const manifest = readManifest(uploadId);
  if (!manifest) {
    return res.status(404).json({ message: "Upload not found" });
  }
  if (String(manifest.userId) !== String(req.user.id)) {
    return res.status(403).json({ message: "Not allowed to access this upload" });
  }

  const range = parseContentRange(req.headers["content-range"]);
  if (!range) {
    return res.status(400).json({ message: "Content-Range header is required" });
  }
  if (range.total !== Number(manifest.size || 0)) {
    return res.status(400).json({ message: "Upload size mismatch" });
  }
  const expectedOffset = Number(manifest.received || 0);
  if (range.start !== expectedOffset) {
    return res
      .status(409)
      .json({ message: "Unexpected upload offset", expected: expectedOffset });
  }

  const expectedLength = range.end - range.start + 1;
  let written = 0;
  let responded = false;

  const writeStream = fs.createWriteStream(partPath(uploadId), { flags: "a" });

  req.on("data", (chunk) => {
    written += chunk.length;
  });

  const handleError = (message) => {
    if (responded) return;
    responded = true;
    res.status(500).json({ message: message || "Upload failed" });
  };

  req.on("error", () => handleError("Upload failed"));
  writeStream.on("error", () => handleError("Upload failed"));

  writeStream.on("finish", () => {
    if (responded) return;
    if (written !== expectedLength) {
      responded = true;
      return res.status(400).json({ message: "Chunk size mismatch" });
    }
    manifest.received = expectedOffset + written;
    writeManifest(manifest);
    responded = true;
    return res.json({ received: manifest.received, done: manifest.received >= manifest.size });
  });

  req.pipe(writeStream);
});

router.post("/:id/complete", auth, async (req, res) => {
  try {
    const uploadId = req.params.id;
    const manifest = readManifest(uploadId);
    if (!manifest) {
      return res.status(404).json({ message: "Upload not found" });
    }
    if (String(manifest.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: "Not allowed to access this upload" });
    }
    if (Number(manifest.received || 0) < Number(manifest.size || 0)) {
      return res.status(409).json({ message: "Upload is not complete yet" });
    }

    const inputPath = partPath(uploadId);
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ message: "Upload data missing" });
    }

    const baseMovie = {
      title: manifest.title || "Untitled",
      uploader: req.user.id,
      views: 0,
      fileSize: manifest.size,
      fileName: manifest.fileName,
      filePath: null,
      storageProvider: isR2Enabled() ? "r2" : "local",
      processingStatus: "processing",
      processingError: ""
    };

    if (manifest.kind === "episode") {
      const series = await Series.findById(manifest.seriesId);
      if (!series) {
        return res.status(404).json({ message: "Series not found" });
      }
      if (String(series.uploader) !== String(req.user.id)) {
        return res.status(403).json({ message: "Not allowed to upload to this series" });
      }

      const seasonNumber = Number(manifest.seasonNumber || 1);
      let episodeNumber = Number(manifest.episodeNumber || 0);
      if (!episodeNumber) {
        const existing = await Movie.find({ seriesId: manifest.seriesId, seasonNumber });
        const max = existing.reduce((acc, item) => Math.max(acc, Number(item.episodeNumber) || 0), 0);
        episodeNumber = max + 1;
      }

      const episodeTitle = manifest.title
        ? String(manifest.title).trim()
        : `Episode ${episodeNumber}`;

      baseMovie.title = episodeTitle;
      baseMovie.isEpisode = true;
      baseMovie.seriesId = manifest.seriesId;
      baseMovie.seriesTitle = series.title;
      baseMovie.headerImage = series.headerImage || null;
      baseMovie.seasonNumber = seasonNumber;
      baseMovie.episodeNumber = episodeNumber;
    }

    const movie = await Movie.create(baseMovie);
    await User.findByIdAndUpdate(req.user.id, { $push: { uploadedMovies: movie._id } });

    manifest.status = "processing";
    writeManifest(manifest);

    enqueue(() =>
      processMovieUpload({
        movieId: movie._id,
        inputPath,
        torrentClient: req.app.locals.torrentClient,
        trackers: req.app.locals.trackers
      })
    ).catch((err) => {
      console.error("Resumable upload processing failed:", err);
    });

    return res.json(movie);
  } catch (err) {
    return res.status(500).json({ message: "Failed to finalize upload" });
  }
});

router.delete("/:id", auth, async (req, res) => {
  const uploadId = req.params.id;
  const manifest = readManifest(uploadId);
  if (manifest && String(manifest.userId) !== String(req.user.id)) {
    return res.status(403).json({ message: "Not allowed to cancel this upload" });
  }
  safeRemoveDir(sessionDir(uploadId));
  return res.json({ message: "Upload cancelled" });
});

module.exports = router;
