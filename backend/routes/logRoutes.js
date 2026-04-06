const express = require("express");
const auth = require("../middleware/auth");
const { getLogs, getAnalytics } = require("../controllers/logController");

const router = express.Router();

router.use(auth);
router.get("/", getLogs);
router.get("/analytics", getAnalytics);

module.exports = router;
