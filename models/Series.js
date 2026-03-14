const useFileDb = process.env.USE_FILE_DB === "1";

if (useFileDb) {
  const { createModel } = require("../server/fileDb");
  module.exports = createModel("series");
} else {
  const mongoose = require("mongoose");

  const SeriesSchema = new mongoose.Schema(
    {
      title: { type: String, required: true, trim: true },
      uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      seasonsCount: { type: Number, required: true, min: 1 },
      description: { type: String, trim: true },
      headerImage: { type: String, trim: true }
    },
    { timestamps: true }
  );

  module.exports = mongoose.model("Series", SeriesSchema);
}
