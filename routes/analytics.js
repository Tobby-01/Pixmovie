const express = require("express");
const auth = require("../server/middleware/auth");
const Movie = require("../models/Movie");

const router = express.Router();

function dayKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastNDays(count) {
  const days = [];
  const today = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(dayKey(d));
  }
  return days;
}

function buildSeries(movies) {
  const labels = lastNDays(7);
  const uploads = labels.map(() => 0);
  const views = labels.map(() => 0);
  const indexMap = new Map(labels.map((label, idx) => [label, idx]));

  movies.forEach((movie) => {
    const uploadDay = dayKey(movie.uploadDate || movie.createdAt || new Date());
    const uploadIndex = indexMap.get(uploadDay);
    if (uploadIndex !== undefined) {
      uploads[uploadIndex] += 1;
    }

    const history = Array.isArray(movie.viewHistory) ? movie.viewHistory : [];
    if (history.length) {
      history.forEach((entry) => {
        const idx = indexMap.get(entry.date);
        if (idx !== undefined) {
          views[idx] += Number(entry.count || 0);
        }
      });
    } else if (movie.views) {
      if (uploadIndex !== undefined) {
        views[uploadIndex] += Number(movie.views || 0);
      }
    }
  });

  return { labels, uploads, views };
}

router.get("/me", auth, async (req, res) => {
  try {
    const movies = await Movie.find({ uploader: req.user.id });
    const uploads = movies.length;
    const totalViews = movies.reduce((sum, m) => sum + (m.views || 0), 0);
    const bandwidthBytes = movies.reduce(
      (sum, m) => sum + (m.fileSize || 0) * (m.views || 0),
      0
    );

    return res.json({
      uploads,
      totalViews,
      totalPlays: totalViews,
      bandwidthBytes,
      series: buildSeries(movies)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load analytics" });
  }
});

router.get("/overall", async (req, res) => {
  try {
    const movies = await Movie.find({});
    const totalMovies = movies.length;
    const totalViews = movies.reduce((sum, m) => sum + (m.views || 0), 0);
    const bandwidthBytes = movies.reduce(
      (sum, m) => sum + (m.fileSize || 0) * (m.views || 0),
      0
    );

    return res.json({
      totalMovies,
      totalViews,
      totalPlays: totalViews,
      bandwidthBytes,
      series: buildSeries(movies)
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load analytics" });
  }
});

module.exports = router;
