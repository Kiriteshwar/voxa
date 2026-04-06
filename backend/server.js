const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const authRoutes = require("./routes/authRoutes");
const habitRoutes = require("./routes/habitRoutes");
const logRoutes = require("./routes/logRoutes");
const noteRoutes = require("./routes/noteRoutes");
const reminderRoutes = require("./routes/reminderRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const activityRoutes = require("./routes/activityRoutes");
const historyRoutes = require("./routes/historyRoutes");
const aiRoutes = require("./routes/aiRoutes");

const app = express();
const port = process.env.PORT || 4000;
const clientOrigin = process.env.CLIENT_ORIGIN || `http://localhost:${port}`;
const frontendDir = path.join(__dirname, "..", "frontend");

app.use(
  cors({
    origin: clientOrigin,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.static(frontendDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "VoxaHabit API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/habits", habitRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/notes", noteRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/ai", aiRoutes);

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }

  return res.sendFile(path.join(frontendDir, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    message: err.message || "Internal server error",
  });
});

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected");
    app.listen(port, () => {
      console.log(`VoxaHabit server running on port ${clientOrigin}`);
    });
  } catch (error) {
    console.error("Failed to start server", error.message);
    process.exit(1);
  }
}

startServer();
