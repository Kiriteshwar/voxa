const express = require("express");
const auth = require("../middleware/auth");
const { getActivity } = require("../controllers/activityController");

const router = express.Router();

router.use(auth);
router.get("/", getActivity);

module.exports = router;
