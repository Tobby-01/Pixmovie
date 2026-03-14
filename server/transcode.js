const { spawn } = require("child_process");
const path = require("path");
const { spawnSync } = require("child_process");

function transcodeToMp4(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath.replace(/\.[^/.]+$/, ".mp4");
    const args = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
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
