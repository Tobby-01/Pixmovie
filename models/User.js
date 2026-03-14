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
      uploadedMovies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Movie" }]
    },
    { timestamps: true }
  );

  module.exports = mongoose.model("User", UserSchema);
}
