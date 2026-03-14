const express = require("express");
const { isFfmpegAvailable } = require("../server/transcode");

const router = express.Router();

router.get("/ffmpeg", (req, res) => {
  res.json({ available: isFfmpegAvailable() });
});

module.exports = router;
