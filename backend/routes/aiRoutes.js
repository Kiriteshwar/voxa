const express = require("express");
const auth = require("../middleware/auth");
const { parseVoiceCommand, executeVoiceCommand } = require("../controllers/aiController");

const router = express.Router();

router.post("/parse", parseVoiceCommand);
router.post("/execute", auth, executeVoiceCommand);

module.exports = router;
