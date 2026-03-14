const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const Movie = require("../models/Movie");
const authRoutes = require("../routes/auth");
const movieRoutes = require("../routes/movies");
const userRoutes = require("../routes/users");
const analyticsRoutes = require("../routes/analytics");
const seriesRoutes = require("../routes/series");
const systemRoutes = require("../routes/system");

const app = express();
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/pixmovie";
const USE_FILE_DB = process.env.USE_FILE_DB === "1";

const WEBRTC_TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.fastcast.nz",
  "wss://tracker.files.fm:7073/announce"
];

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

const publicDir = path.join(__dirname, "..", "public");
const moviesDir = path.join(__dirname, "..", "movies");
const headersDir = path.join(__dirname, "..", "public", "headers");
if (!fs.existsSync(moviesDir)) {
  fs.mkdirSync(moviesDir, { recursive: true });
}
if (!fs.existsSync(headersDir)) {
  fs.mkdirSync(headersDir, { recursive: true });
}

app.use(express.static(publicDir));
app.use("/movies", express.static(moviesDir));
app.use("/headers", express.static(headersDir));

app.use("/api/auth", authRoutes);
app.use("/api/movies", movieRoutes);
app.use("/api/users", userRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/series", seriesRoutes);
app.use("/api/system", systemRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

async function seedExistingMovies(torrentClient) {
  const movies = await Movie.find({});
  for (const movie of movies) {
    const relativePath = movie.filePath || movie.fileName;
    const fullPath = path.join(moviesDir, relativePath || "");
    if (!relativePath || !fs.existsSync(fullPath)) {
      continue;
    }

    torrentClient.seed(fullPath, { announce: WEBRTC_TRACKERS }, async (torrent) => {
      if (movie.magnetLink !== torrent.magnetURI) {
        movie.magnetLink = torrent.magnetURI;
        await movie.save();
      }
    });
  }
}

async function startServer() {
  const { default: WebTorrent } = await import("webtorrent");

  const torrentClient = new WebTorrent();
  app.locals.torrentClient = torrentClient;
  app.locals.trackers = WEBRTC_TRACKERS;

  if (USE_FILE_DB) {
    await seedExistingMovies(torrentClient);
    app.listen(PORT, () => {
      console.log(`PixMovie server running on port ${PORT}`);
    });
    return;
  }

  try {
    await mongoose.connect(MONGO_URI);
    await seedExistingMovies(torrentClient);
    app.listen(PORT, () => {
      console.log(`PixMovie server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  }
}

startServer().catch((err) => {
  console.error("Server startup error:", err.message);
  process.exit(1);
});
