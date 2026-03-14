const useFileDb = process.env.USE_FILE_DB === "1";

if (useFileDb) {
  const { createModel } = require("../server/fileDb");
  module.exports = createModel("users");
} else {
  const mongoose = require("mongoose");

  const UserSchema = new mongoose.Schema(
    {
      username: { type: String, required: true, unique: true, trim: true },
      email: { type: String, required: true, unique: true, trim: true, lowercase: true },
      passwordHash: { type: String, required: true },
      avatarUrl: { type: String, trim: true },
      bio: { type: String, trim: true, maxlength: 280 },
      uploadedMovies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Movie" }],
      watchlist: [{ type: mongoose.Schema.Types.ObjectId, ref: "Movie" }],
      watchHistory: [
        {
          movieId: { type: mongoose.Schema.Types.ObjectId, ref: "Movie" },
          lastPosition: { type: Number, default: 0 },
          duration: { type: Number, default: 0 },
          progress: { type: Number, default: 0 },
          updatedAt: { type: Date, default: Date.now }
        }
      ],
      followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
    },
    { timestamps: true }
  );

  module.exports = mongoose.model("User", UserSchema);
}
