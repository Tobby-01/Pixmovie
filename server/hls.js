const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function transcodeToHls(inputPath, outputDir, options = {}) {
  return new Promise((resolve, reject) => {
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, "index.m3u8");
    const segmentPath = path.join(outputDir, "segment_%03d.ts");
    const lowData = Boolean(options.lowData);

    const args = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      lowData ? "28" : "23",
      ...(lowData ? ["-vf", "scale=-2:480"] : []),
      "-c:a",
      "aac",
      "-b:a",
      lowData ? "96k" : "128k",
      "-f",
      "hls",
      "-hls_time",
      "6",
      "-hls_list_size",
      "0",
      "-hls_segment_filename",
      segmentPath,
      outputPath
    ];

    const ffmpeg = spawn("ffmpeg", args, { windowsHide: true });
    let errorText = "";

    ffmpeg.stderr.on("data", (data) => {
      errorText += data.toString();
    });

    ffmpeg.on("error", () => {
      reject(new Error("FFmpeg is not installed or not on PATH."));
    });

    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(errorText || `FFmpeg failed with code ${code}.`));
      }
    });
  });
}

module.exports = { transcodeToHls };
