const mongoose = require("mongoose");

const logSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    habitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Habit",
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["completed", "skipped"],
      required: true,
    },
    source: {
      type: String,
      enum: ["manual", "voice", "system"],
      default: "manual",
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

logSchema.index({ habitId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Log", logSchema);
