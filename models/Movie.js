const useFileDb = process.env.USE_FILE_DB === "1";

if (useFileDb) {
  const { createModel } = require("../server/fileDb");
  module.exports = createModel("movies");
} else {
  const mongoose = require("mongoose");

  const MovieSchema = new mongoose.Schema(
    {
      title: { type: String, required: true, trim: true },
      uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      uploadDate: { type: Date, default: Date.now },
      magnetLink: { type: String, default: "" },
      views: { type: Number, default: 0 },
      viewHistory: [
        {
          date: { type: String },
          count: { type: Number, default: 0 }
        }
      ],
      fileSize: { type: Number, required: true },
      fileName: { type: String, required: true },
      filePath: { type: String, trim: true },
      storageProvider: { type: String, default: "local" },
      storageKey: { type: String, trim: true },
      headerImage: { type: String, trim: true },
      isEpisode: { type: Boolean, default: false },
      seriesId: { type: mongoose.Schema.Types.ObjectId, ref: "Series" },
      seriesTitle: { type: String, trim: true },
      seasonNumber: { type: Number },
      episodeNumber: { type: Number },
      ratings: [
        {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          score: { type: Number, min: 1, max: 5 },
          comment: { type: String, trim: true, maxlength: 500 },
          createdAt: { type: Date, default: Date.now }
        }
      ],
      ratingAverage: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 }
    },
    { timestamps: true }
  );

  module.exports = mongoose.model("Movie", MovieSchema);
}
