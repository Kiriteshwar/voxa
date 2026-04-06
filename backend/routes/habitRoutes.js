const express = require("express");
const auth = require("../middleware/auth");
const {
  getHabits,
  createHabit,
  updateHabit,
  deleteHabit,
  markHabit,
} = require("../controllers/habitController");

const router = express.Router();

router.use(auth);
router.get("/", getHabits);
router.post("/", createHabit);
router.patch("/:id", updateHabit);
router.delete("/:id", deleteHabit);
router.post("/:id/mark", markHabit);

module.exports = router;
