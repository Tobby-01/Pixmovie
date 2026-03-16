const { spawn } = require("child_process");
const path = require("path");
const { spawnSync } = require("child_process");

function defaultCompressedOutputPath(inputPath) {
  const ext = path.extname(inputPath);
  const base = ext ? inputPath.slice(0, -ext.length) : inputPath;
  return `${base}_compressed.mp4`;
}

function transcodeToMp4(inputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const requestedOutput =
      typeof options.outputPath === "string" && options.outputPath
        ? options.outputPath
        : inputPath.replace(/\.[^/.]+$/, ".mp4");
    const outputPath =
      path.normalize(requestedOutput) === path.normalize(inputPath)
        ? defaultCompressedOutputPath(inputPath)
        : requestedOutput;
    const crf = options.crf != null ? String(options.crf) : "23";
    const preset = options.preset != null ? String(options.preset) : "veryfast";
    const audioBitrate = options.audioBitrate != null ? String(options.audioBitrate) : "128k";
    const videoFilter =
      typeof options.videoFilter === "string" && options.videoFilter ? options.videoFilter : "";
    const args = [
      "-y",
      "-i",
      inputPath,
      ...(videoFilter ? ["-vf", videoFilter] : []),
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      "-c:a",
      "aac",
      "-b:a",
      audioBitrate,
      "-movflags",
      "+faststart",
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
      if (code === 0) {
        resolve(path.normalize(outputPath));
      } else {
        reject(new Error(errorText || `FFmpeg failed with code ${code}.`));
      }
    });
  });
}

function isFfmpegAvailable() {
  const result = spawnSync("ffmpeg", ["-version"], { windowsHide: true });
  return result.status === 0;
}

module.exports = { transcodeToMp4, isFfmpegAvailable };
