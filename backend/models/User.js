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
    assistantMemory: {
      lastCreated: {
        entityType: { type: String, default: "" },
        itemId: { type: mongoose.Schema.Types.ObjectId, default: null },
        title: { type: String, default: "" },
        updatedAt: { type: Date, default: null },
      },
      lastDeleted: {
        entityType: { type: String, default: "" },
        itemId: { type: mongoose.Schema.Types.ObjectId, default: null },
        title: { type: String, default: "" },
        snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
        updatedAt: { type: Date, default: null },
      },
      lastCompleted: {
        entityType: { type: String, default: "" },
        itemId: { type: mongoose.Schema.Types.ObjectId, default: null },
        title: { type: String, default: "" },
        updatedAt: { type: Date, default: null },
      },
      lastViewed: {
        entityType: { type: String, default: "" },
        itemId: { type: mongoose.Schema.Types.ObjectId, default: null },
        title: { type: String, default: "" },
        updatedAt: { type: Date, default: null },
      },
      lastUndo: {
        actionType: { type: String, default: "" },
        entityType: { type: String, default: "" },
        itemId: { type: mongoose.Schema.Types.ObjectId, default: null },
        snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
        updatedAt: { type: Date, default: null },
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
