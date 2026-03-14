const express = require("express");
const mongoose = require("mongoose");
const { isFfmpegAvailable } = require("../server/transcode");
const { isR2Enabled, checkBucket } = require("../server/r2");

const router = express.Router();

router.get("/ffmpeg", (req, res) => {
  res.json({ available: isFfmpegAvailable() });
});

router.get("/health", async (req, res) => {
  const useFileDb = process.env.USE_FILE_DB === "1";
  const db = { mode: useFileDb ? "file" : "mongo", connected: false };
  if (!useFileDb) {
    db.state = mongoose.connection.readyState;
    try {
      if (mongoose.connection.db) {
        await mongoose.connection.db.admin().ping();
        db.connected = true;
      }
    } catch (err) {
      db.error = err.message || "MongoDB ping failed";
    }
  } else {
    db.connected = true;
  }

  const r2 = { enabled: isR2Enabled(), ok: false };
  if (r2.enabled) {
    try {
      await checkBucket();
      r2.ok = true;
    } catch (err) {
      r2.error = err.message || "R2 check failed";
    }
  }

  res.json({ db, r2 });
});

module.exports = router;
