const mongoose = require("mongoose");

const habitSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    repeat: {
      type: String,
      enum: ["daily", "weekly", "custom", "none"],
      default: "daily",
    },
    time: {
      type: String,
      default: "",
    },
    scheduledDate: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "completed", "skipped"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Habit", habitSchema);
