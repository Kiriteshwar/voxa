const express = require("express");
const auth = require("../middleware/auth");
const { getHistory } = require("../controllers/activityController");

const router = express.Router();

router.use(auth);
router.get("/", getHistory);

module.exports = router;
