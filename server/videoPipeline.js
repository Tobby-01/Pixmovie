const fs = require("fs");
const path = require("path");
const Movie = require("../models/Movie");
const { compressToH265, packageToHls, generateThumbnail, probeDuration } = require("./media");
const { isR2Enabled, uploadLocalFile, contentTypeFromKey } = require("./r2");

const moviesDir = path.join(__dirname, "..", "movies");

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

async function processMovieUpload({ movieId, inputPath }) {
  const movie = await Movie.findById(movieId);
  if (!movie) {
    safeUnlink(inputPath);
    throw new Error("Movie record not found for processing.");
  }

  const movieDir = path.join(moviesDir, String(movieId));
  ensureDir(movieDir);

  const compressedPath = path.join(movieDir, "compressed.mp4");
  const lowPath = path.join(movieDir, "low.mp4");
  const thumbnailPath = path.join(movieDir, "thumbnail.jpg");

  try {
    await compressToH265(inputPath, compressedPath);
    await compressToH265(inputPath, lowPath, {
      crf: "30",
      audioBitrate: "96k",
      scaleFilter: "scale=if(gt(ih,360),-2,iw):if(gt(ih,360),360,ih)"
    });
    await generateThumbnail(compressedPath, thumbnailPath);
    const standardDir = path.join(movieDir, "standard");
    const lowDir = path.join(movieDir, "low");

    await packageToHls(compressedPath, standardDir, {
      outputName: "index.m3u8",
      segmentTime: 10,
      segmentPattern: "segment%03d.ts"
    });
    await packageToHls(lowPath, lowDir, {
      outputName: "index.m3u8",
      segmentTime: 10,
      segmentPattern: "segment%03d.ts"
    });

    const masterPath = path.join(movieDir, "master.m3u8");
    const masterContent = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360",
      "low/index.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720",
      "standard/index.m3u8",
      ""
    ].join("\n");
    fs.writeFileSync(masterPath, masterContent);

    const duration = probeDuration(compressedPath);
    const compressedSize = fs.statSync(compressedPath).size;

    let storageProvider = "local";
    let compressedKey = null;
    let hlsKey = null;
    let thumbnailKey = null;
    let filePath = path.relative(moviesDir, compressedPath);

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

    await movie.save();
  } catch (err) {
    movie.processingStatus = "failed";
    movie.processingError = err.message || "Processing failed";
    await movie.save();
    throw err;
  } finally {
    safeUnlink(inputPath);
    safeUnlink(lowPath);
    if (isR2Enabled()) {
      safeRemoveDir(movieDir);
    }
  }

  return movie;
}

module.exports = { processMovieUpload };
