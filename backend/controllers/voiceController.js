const jwt = require("jsonwebtoken");
const {
  createStreamingSession,
  addSseClient,
  pushAudioChunk,
  stopStreamingSession,
} = require("../services/assemblyService");

function resolveToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  if (req.query.token) {
    return String(req.query.token);
  }

  return "";
}

function authenticateStreamRequest(req) {
  const token = resolveToken(req);
  if (!token) {
    const error = new Error("Missing or invalid token");
    error.statusCode = 401;
    throw error;
  }

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (_error) {
    const error = new Error("Token expired or invalid");
    error.statusCode = 401;
    throw error;
  }
}

exports.startVoiceStream = async (req, res, next) => {
  try {
    const session = await createStreamingSession(req.user.id);
    return res.json(session);
  } catch (error) {
    return next(error);
  }
};

exports.streamVoiceEvents = async (req, res, next) => {
  try {
    const user = authenticateStreamRequest(req);
    const { sessionId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const removeClient = addSseClient(sessionId, user.id, res);

    req.on("close", () => {
      removeClient();
    });
  } catch (error) {
    return next(error);
  }
};

exports.sendVoiceAudioChunk = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const audioBase64 = req.body?.audio || "";

    if (!audioBase64) {
      return res.status(400).json({ message: "Audio chunk is required" });
    }

    pushAudioChunk(sessionId, req.user.id, Buffer.from(audioBase64, "base64"));
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

exports.stopVoiceStream = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const payload = await stopStreamingSession(sessionId, req.user.id);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
};
