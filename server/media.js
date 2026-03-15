const { spawn } = require("child_process");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function runFfmpeg(args, errorMessage) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { windowsHide: true });
    let errorText = "";

    ffmpeg.stderr.on("data", (data) => {
      errorText += data.toString();
    });

    ffmpeg.on("error", () => {
      reject(new Error("FFmpeg is not installed or not on PATH."));
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(errorText || errorMessage || `FFmpeg failed with code ${code}.`));
      }
    });
  });
}

function escapeFilter(value) {
  return String(value || "").replace(/,/g, "\\,");
}

function compressToH265(inputPath, outputPath, options = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      ensureDir(path.dirname(outputPath));
      const crf = options.crf || "28";
      const preset = options.preset || "fast";
      const audioBitrate = options.audioBitrate || "128k";
      const rawScaleFilter =
        options.scaleFilter ||
        "scale=if(gt(ih,720),-2,iw):if(gt(ih,720),720,ih)";
      const scaleFilter = escapeFilter(rawScaleFilter);

      const args = [
        "-y",
        "-i",
        inputPath,
        "-vf",
        scaleFilter,
        "-c:v",
        "libx265",
        "-crf",
        String(crf),
        "-preset",
        String(preset),
        "-tag:v",
        "hvc1",
        "-c:a",
        "aac",
        "-b:a",
        String(audioBitrate),
        "-movflags",
        "+faststart",
        outputPath
      ];

      await runFfmpeg(args, "Video compression failed.");
      resolve(path.normalize(outputPath));
    } catch (err) {
      reject(err);
    }
  });
}

function packageToHls(inputPath, outputDir, options = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      ensureDir(outputDir);
      const outputName = options.outputName || "master.m3u8";
      const segmentTime = options.segmentTime || 10;
      const segmentPattern = options.segmentPattern || "segment%03d.ts";
      const outputPath = path.join(outputDir, outputName);
      const segmentPath = path.join(outputDir, segmentPattern);

      const args = [
        "-y",
        "-i",
        inputPath,
        "-codec",
        "copy",
        "-start_number",
        "0",
        "-hls_time",
        String(segmentTime),
        "-hls_list_size",
        "0",
        "-hls_segment_filename",
        segmentPath,
        "-f",
        "hls",
        outputPath
      ];

      await runFfmpeg(args, "HLS packaging failed.");
      if (!fs.existsSync(outputPath)) {
        throw new Error("HLS playlist was not created.");
      }
      resolve(outputPath);
    } catch (err) {
      reject(err);
    }
  });
}

function generateThumbnail(inputPath, outputPath) {
  return new Promise(async (resolve, reject) => {
    try {
      ensureDir(path.dirname(outputPath));
      const args = [
        "-y",
        "-ss",
        "00:00:10",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outputPath
      ];

      await runFfmpeg(args, "Thumbnail generation failed.");
      resolve(path.normalize(outputPath));
    } catch (err) {
      reject(err);
    }
  });
}

function probeDuration(inputPath) {
  try {
    const result = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputPath
      ],
      { windowsHide: true }
    );
    if (result.status !== 0) {
      return null;
    }
    const raw = String(result.stdout || "").trim();
    const duration = Number(raw);
    return Number.isFinite(duration) ? duration : null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  compressToH265,
  packageToHls,
  generateThumbnail,
  probeDuration
};
