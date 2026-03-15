const fs = require("fs");
const path = require("path");
const Movie = require("../models/Movie");
const { compressToH265, packageToHls, generateThumbnail, probeDuration } = require("./media");
const { isR2Enabled, uploadLocalFile, contentTypeFromKey } = require("./r2");

const moviesDir = path.join(__dirname, "..", "movies");
const resumableRoot = path.join(moviesDir, "_uploads", "resumable");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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

function safeRemoveDir(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
}

function collectHlsFiles(rootDir) {
  const results = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".m3u8") || entry.name.endsWith(".ts")) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(rootDir);
  return results;
}

async function uploadHlsFolder(movieId, movieDir) {
  const files = collectHlsFiles(movieDir);
  for (const filePath of files) {
    const relativePath = path.relative(movieDir, filePath).replace(/\\/g, "/");
    const key = `movies/${movieId}/${relativePath}`;
    await uploadLocalFile({
      key,
      filePath,
      contentType: contentTypeFromKey(key)
    });
  }
}

async function processMovieUpload({ movieId, inputPath, torrentClient, trackers }) {
  const movie = await Movie.findById(movieId);
  if (!movie) {
    safeUnlink(inputPath);
    throw new Error("Movie record not found for processing.");
  }

  const movieDir = path.join(moviesDir, String(movieId));
  ensureDir(movieDir);

  const profile = String(process.env.PROCESSING_PROFILE || "fast").toLowerCase();
  const useFullLadder = profile === "ladder" || profile === "full";
  const preset = profile === "fast" ? "superfast" : "fast";

  const compressedPath = path.join(movieDir, "compressed.mp4");
  const lowPath = path.join(movieDir, "low.mp4");
  const midPath = path.join(movieDir, "mid.mp4");
  const thumbnailPath = path.join(movieDir, "thumbnail.jpg");

  try {
    await compressToH265(inputPath, compressedPath, {
      crf: "28",
      preset,
      audioBitrate: "128k",
      scaleFilter: "scale=if(gt(ih,720),-2,iw):if(gt(ih,720),720,ih)"
    });
    if (useFullLadder) {
      await compressToH265(inputPath, midPath, {
        crf: "29",
        preset,
        audioBitrate: "96k",
        scaleFilter: "scale=if(gt(ih,480),-2,iw):if(gt(ih,480),480,ih)"
      });
    }
    await compressToH265(inputPath, lowPath, {
      crf: "31",
      preset,
      audioBitrate: "64k",
      scaleFilter: "scale=if(gt(ih,240),-2,iw):if(gt(ih,240),240,ih)"
    });
    await generateThumbnail(compressedPath, thumbnailPath);
    const hls720Dir = path.join(movieDir, "hls", "720");
    const hls240Dir = path.join(movieDir, "hls", "240");

    await packageToHls(compressedPath, hls720Dir, {
      outputName: "index.m3u8",
      segmentTime: 10,
      segmentPattern: "segment%03d.ts"
    });
    if (useFullLadder) {
      const hls480Dir = path.join(movieDir, "hls", "480");
      await packageToHls(midPath, hls480Dir, {
        outputName: "index.m3u8",
        segmentTime: 10,
        segmentPattern: "segment%03d.ts"
      });
    }
    await packageToHls(lowPath, hls240Dir, {
      outputName: "index.m3u8",
      segmentTime: 10,
      segmentPattern: "segment%03d.ts"
    });

    const masterPath = path.join(movieDir, "master.m3u8");
    const masterLines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-STREAM-INF:BANDWIDTH=350000,RESOLUTION=426x240",
      "hls/240/index.m3u8"
    ];
    if (useFullLadder) {
      masterLines.push(
        "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480",
        "hls/480/index.m3u8"
      );
    }
    masterLines.push(
      "#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720",
      "hls/720/index.m3u8",
      ""
    );
    const masterContent = masterLines.join("\n");
    fs.writeFileSync(masterPath, masterContent);

    const duration = probeDuration(compressedPath);
    const compressedSize = fs.statSync(compressedPath).size;

    let storageProvider = "local";
    let compressedKey = null;
    let hlsKey = null;
    let thumbnailKey = null;
    let filePath = path.relative(moviesDir, compressedPath);
    let magnetLink = movie.magnetLink || "";

    if (isR2Enabled()) {
      storageProvider = "r2";
      compressedKey = `movies/${movieId}/compressed.mp4`;
      hlsKey = `movies/${movieId}/master.m3u8`;
      thumbnailKey = `movies/${movieId}/thumbnail.jpg`;

      await uploadLocalFile({
        key: compressedKey,
        filePath: compressedPath,
        contentType: contentTypeFromKey(compressedKey)
      });
      await uploadLocalFile({
        key: thumbnailKey,
        filePath: thumbnailPath,
        contentType: contentTypeFromKey(thumbnailKey)
      });
      await uploadHlsFolder(movieId, movieDir);

      filePath = null;
    }

    if (storageProvider === "local" && torrentClient) {
      try {
        const torrent = await new Promise((resolve, reject) => {
          torrentClient.seed(compressedPath, { announce: trackers || [] }, (t) => resolve(t));
        });
        magnetLink = torrent.magnetURI;
      } catch (err) {
        // Ignore seeding errors
      }
    }

    movie.processingStatus = "ready";
    movie.processingError = "";
    movie.storageProvider = storageProvider;
    movie.fileName = "compressed.mp4";
    movie.filePath = filePath;
    movie.fileSize = compressedSize;
    movie.storageKey = compressedKey || null;
    movie.compressedKey = compressedKey || null;
    movie.hlsKey = hlsKey || null;
    movie.thumbnailUrl = `/api/movies/${movieId}/thumbnail`;
    movie.streamingUrl = `/api/movies/${movieId}/hls/master.m3u8`;
    movie.duration = duration;
    movie.magnetLink = magnetLink || "";

    await movie.save();
  } catch (err) {
    movie.processingStatus = "failed";
    movie.processingError = err.message || "Processing failed";
    await movie.save();
    throw err;
  } finally {
    safeUnlink(inputPath);
    const normalizedInput = path.normalize(inputPath);
    if (normalizedInput.startsWith(path.normalize(resumableRoot))) {
      safeRemoveDir(path.dirname(normalizedInput));
    }
    safeUnlink(lowPath);
    if (useFullLadder) {
      safeUnlink(midPath);
    }
    if (isR2Enabled()) {
      safeRemoveDir(movieDir);
    }
  }

  return movie;
}

module.exports = { processMovieUpload };
