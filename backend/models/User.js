const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    voiceContext: {
      entityType: {
        type: String,
        default: "",
      },
      itemId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      title: {
        type: String,
        default: "",
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
