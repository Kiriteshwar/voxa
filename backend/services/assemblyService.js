const crypto = require("crypto");
const WebSocket = require("ws");

const ASSEMBLY_API_BASE = process.env.ASSEMBLY_API_BASE || "https://api.assemblyai.com";
const ASSEMBLY_WS_BASE = "wss://streaming.assemblyai.com/v3/ws";
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_CHUNK_MS = 200;
const SESSION_TTL_MS = 5 * 60 * 1000;

const sessions = new Map();

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitWords(value = "") {
  return normalizeWhitespace(value).split(" ").filter(Boolean);
}

function collapseConsecutiveWordRepeats(text = "") {
  const words = splitWords(text);
  const compact = [];

  for (const word of words) {
    const current = word.toLowerCase();
    const previous = compact[compact.length - 1]?.toLowerCase();
    if (current && current === previous) {
      continue;
    }
    compact.push(word);
  }

  return compact.join(" ");
}

function collapseRepeatedTailPhrases(text = "") {
  const words = splitWords(text);
  if (words.length < 4) {
    return words.join(" ");
  }

  for (let phraseSize = Math.min(5, Math.floor(words.length / 2)); phraseSize >= 2; phraseSize -= 1) {
    const tail = words.slice(-phraseSize).join(" ").toLowerCase();
    const previous = words.slice(-phraseSize * 2, -phraseSize).join(" ").toLowerCase();
    if (tail && tail === previous) {
      return words.slice(0, -phraseSize).join(" ");
    }
  }

  return words.join(" ");
}

function removeFillerWords(text = "") {
  return normalizeWhitespace(
    text
      .replace(/\b(?:um|uh|hmm|erm|ah)\b/gi, " ")
      .replace(/\s+,/g, ",")
      .replace(/\s+[.?!,]/g, " ")
  );
}

function cleanTranscriptText(text = "") {
  return normalizeWhitespace(removeFillerWords(collapseRepeatedTailPhrases(collapseConsecutiveWordRepeats(text))));
}

function createSessionId() {
  return crypto.randomUUID();
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function ensureSessionOwnership(sessionId, userId) {
  const session = getSession(sessionId);
  if (!session || session.userId !== userId) {
    throw new Error("Voice streaming session not found.");
  }
  return session;
}

function getCompiledFinalTranscript(session) {
  return cleanTranscriptText(
    [...session.finalTurns.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, value]) => value)
      .join(" ")
  );
}

function getCombinedTranscript(session) {
  return cleanTranscriptText([getCompiledFinalTranscript(session), session.interimTranscript].filter(Boolean).join(" "));
}

function writeSse(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(session, eventName, payload) {
  const message = payload || {};
  session.clients.forEach((res) => {
    try {
      writeSse(res, eventName, message);
    } catch (_error) {
      session.clients.delete(res);
    }
  });
}

function touchSession(session) {
  session.lastActivityAt = Date.now();
}

function buildTranscriptPayload(session, meta = {}) {
  return {
    sessionId: session.id,
    finalTranscript: getCompiledFinalTranscript(session),
    interimTranscript: session.interimTranscript,
    liveTranscript: getCombinedTranscript(session),
    lastFinalTranscript: session.lastFinalTranscript,
    ...meta,
  };
}

async function createTemporaryToken(apiKey) {
  const url = new URL("/v3/token", ASSEMBLY_API_BASE);
  url.searchParams.set("expires_in_seconds", "300");
  url.searchParams.set("max_session_duration_seconds", "1800");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AssemblyAI token request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  return payload.token;
}

function connectAssemblySocket(session, token) {
  const url = new URL(ASSEMBLY_WS_BASE);
  url.searchParams.set("token", token);
  url.searchParams.set("sample_rate", String(session.sampleRate));
  url.searchParams.set("encoding", "pcm_s16le");
  url.searchParams.set("speech_model", "universal-streaming-multilingual");
  url.searchParams.set("format_turns", "true");
  url.searchParams.set("inactivity_timeout", "30");

  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";

  session.socket = socket;

  socket.addEventListener("open", () => {
    session.status = "connected";
    touchSession(session);
    broadcast(session, "session.ready", {
      sessionId: session.id,
      sampleRate: session.sampleRate,
      chunkMs: session.chunkMs,
    });

    while (session.pendingAudio.length) {
      const chunk = session.pendingAudio.shift();
      socket.send(chunk);
    }
  });

  socket.addEventListener("message", (event) => {
    touchSession(session);

    let message;
    try {
      message = JSON.parse(event.data);
    } catch (_error) {
      return;
    }

    if (message.type === "Begin") {
      session.remoteSessionId = message.id;
      broadcast(session, "session.begin", {
        sessionId: session.id,
        remoteSessionId: message.id,
        expiresAt: message.expires_at,
      });
      return;
    }

    if (message.type === "Turn") {
      const transcript = cleanTranscriptText(message.transcript || "");
      const turnOrder = Number(message.turn_order ?? 0);

      if (message.end_of_turn) {
        if (transcript) {
          session.finalTurns.set(turnOrder, transcript);
          session.lastFinalTranscript = transcript;
        }
        session.interimTranscript = "";
      } else {
        session.interimTranscript = transcript;
      }

      const payload = buildTranscriptPayload(session, {
        endOfTurn: Boolean(message.end_of_turn),
        turnOrder,
        turnIsFormatted: Boolean(message.turn_is_formatted),
        endOfTurnConfidence: Number(message.end_of_turn_confidence || 0),
      });

      const signature = JSON.stringify(payload);
      if (signature !== session.lastBroadcastSignature) {
        session.lastBroadcastSignature = signature;
        broadcast(session, "transcript", payload);
      }
      return;
    }

    if (message.type === "Termination") {
      broadcast(session, "session.terminated", {
        sessionId: session.id,
        finalTranscript: getCompiledFinalTranscript(session),
        audioDurationSeconds: message.audio_duration_seconds || 0,
      });
      cleanupSession(session.id);
    }
  });

  socket.addEventListener("error", () => {
    broadcast(session, "session.error", {
      sessionId: session.id,
      message: "AssemblyAI streaming connection failed.",
    });
  });

  socket.addEventListener("close", () => {
    if (sessions.has(session.id)) {
      broadcast(session, "session.closed", {
        sessionId: session.id,
        finalTranscript: getCompiledFinalTranscript(session),
      });
      cleanupSession(session.id);
    }
  });
}

function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
  }

  session.clients.forEach((res) => {
    try {
      res.end();
    } catch (_error) {
      return;
    }
  });

  try {
    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      session.socket.close();
    }
  } catch (_error) {
    return;
  }

  sessions.delete(sessionId);
}

function scheduleSessionExpiry(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
  }

  session.timeoutId = setTimeout(() => {
    const current = sessions.get(sessionId);
    if (!current) {
      return;
    }

    if (Date.now() - current.lastActivityAt >= SESSION_TTL_MS) {
      broadcast(current, "session.error", {
        sessionId,
        message: "Voice session expired due to inactivity.",
      });
      cleanupSession(sessionId);
      return;
    }

    scheduleSessionExpiry(sessionId);
  }, SESSION_TTL_MS);
}

async function createStreamingSession(userId) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error("AssemblyAI is not configured on the server.");
  }

  const token = await createTemporaryToken(apiKey);
  const session = {
    id: createSessionId(),
    userId,
    sampleRate: DEFAULT_SAMPLE_RATE,
    chunkMs: DEFAULT_CHUNK_MS,
    socket: null,
    status: "connecting",
    finalTurns: new Map(),
    interimTranscript: "",
    lastFinalTranscript: "",
    lastBroadcastSignature: "",
    pendingAudio: [],
    clients: new Set(),
    remoteSessionId: "",
    lastActivityAt: Date.now(),
    timeoutId: null,
  };

  sessions.set(session.id, session);
  scheduleSessionExpiry(session.id);
  connectAssemblySocket(session, token);

  return {
    sessionId: session.id,
    sampleRate: session.sampleRate,
    chunkMs: session.chunkMs,
  };
}

function addSseClient(sessionId, userId, res) {
  const session = ensureSessionOwnership(sessionId, userId);
  session.clients.add(res);
  touchSession(session);

  writeSse(res, "session.connected", {
    sessionId,
    sampleRate: session.sampleRate,
    chunkMs: session.chunkMs,
    finalTranscript: getCompiledFinalTranscript(session),
    interimTranscript: session.interimTranscript,
    liveTranscript: getCombinedTranscript(session),
  });

  return () => {
    session.clients.delete(res);
  };
}

function pushAudioChunk(sessionId, userId, audioBuffer) {
  const session = ensureSessionOwnership(sessionId, userId);
  if (!audioBuffer || !audioBuffer.length) {
    return;
  }

  touchSession(session);

  if (session.socket && session.socket.readyState === WebSocket.OPEN) {
    session.socket.send(audioBuffer);
    return;
  }

  session.pendingAudio.push(audioBuffer);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopStreamingSession(sessionId, userId) {
  const session = ensureSessionOwnership(sessionId, userId);
  touchSession(session);

  if (session.socket && session.socket.readyState === WebSocket.OPEN) {
    session.socket.send(JSON.stringify({ type: "ForceEndpoint" }));
    await delay(350);
    session.socket.send(JSON.stringify({ type: "Terminate" }));
    await delay(150);
  }

  const finalTranscript = getCompiledFinalTranscript(session) || session.interimTranscript;
  cleanupSession(sessionId);

  return {
    sessionId,
    finalTranscript: cleanTranscriptText(finalTranscript),
  };
}

module.exports = {
  cleanTranscriptText,
  createStreamingSession,
  addSseClient,
  pushAudioChunk,
  stopStreamingSession,
};
