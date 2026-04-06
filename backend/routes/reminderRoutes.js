const express = require("express");
const auth = require("../middleware/auth");
const {
  getReminders,
  createReminder,
  updateReminder,
  deleteReminder,
  snoozeReminder,
  stopReminder,
} = require("../controllers/reminderController");

const router = express.Router();

router.use(auth);
router.get("/", getReminders);
router.post("/", createReminder);
router.patch("/:id", updateReminder);
router.delete("/:id", deleteReminder);
router.post("/:id/snooze", snoozeReminder);
router.post("/:id/stop", stopReminder);

module.exports = router;
