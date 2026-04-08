const express = require("express");
const auth = require("../middleware/auth");
const {
  startVoiceStream,
  streamVoiceEvents,
  sendVoiceAudioChunk,
  stopVoiceStream,
} = require("../controllers/voiceController");

const router = express.Router();

router.post("/start", auth, startVoiceStream);
router.get("/:sessionId/events", streamVoiceEvents);
router.post("/:sessionId/audio", auth, sendVoiceAudioChunk);
router.post("/:sessionId/stop", auth, stopVoiceStream);

module.exports = router;
