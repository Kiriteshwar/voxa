const { GoogleGenerativeAI } = require("@google/generative-ai");
const { parseTimeTo24Hour, parseRelativeDate } = require("./date");

const ACTION_PATTERNS = [
  { action: "delete", patterns: [/\bdelete\b/i, /\bremove\b/i, /\bcancel\b/i] },
  {
    action: "complete",
    patterns: [/\bcomplete\b/i, /\bcompleted\b/i, /\bfinished\b/i, /\bdone\b/i, /\bmark(?:\s+it|\s+that|\s+.+)?\s+done\b/i],
  },
  { action: "skip", patterns: [/\bskip\b/i] },
  { action: "update", patterns: [/\bupdate\b/i, /\bchange\b/i, /\breschedule\b/i, /\bmove\b/i] },
  { action: "snooze", patterns: [/\bsnooze\b/i, /\bremind me later\b/i] },
  { action: "stop", patterns: [/\bstop\b/i, /\bdismiss\b/i] },
  { action: "undo", patterns: [/\bundo\b/i, /\brestore\b/i, /\bdo it again\b/i] },
  { action: "create", patterns: [/\badd\b/i, /\bcreate\b/i, /\bstart\b/i, /\bbegin\b/i, /\bi want to\b/i, /\bnote that\b/i, /\bremind me\b/i] },
];

const ENTITY_PATTERNS = {
  note: [/\bnote\b/i, /\bwrite\b/i, /\bremember\b/i, /\bjot\b/i],
  reminder: [/\bremind\b/i, /\breminder\b/i, /\balert\b/i, /\bnotify\b/i],
  habit: [/\bhabit\b/i, /\bdaily\b/i, /\bevery day\b/i, /\broutine\b/i, /\btask\b/i],
};

const REPEAT_PATTERNS = [
  { repeat: "daily", pattern: /\bevery day\b|\bdaily\b|\bevery morning\b|\bevery evening\b/i },
  { repeat: "weekly", pattern: /\bevery week\b|\bweekly\b/i },
];

const REFERENCE_PATTERN = /\b(it|that|this|last one|last task|that task|that one)\b/i;
const TIME_FRAGMENT_PATTERN = /\b(?:at|around|by|for)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?\b/gi;
const DATE_FRAGMENT_PATTERN = /\b(today|tomorrow|tonight|this weekend|next week)\b/gi;
const REPEAT_FRAGMENT_PATTERN = /\b(every day|daily|every week|weekly|every morning|every evening)\b/gi;
const LEADING_FILLERS_PATTERN = /^(?:hey|okay|ok|please|bro|listen|voxa)\s+/i;
const COMMAND_PREFIX_PATTERNS = [
  /^(?:i want to|i need to|i have to|can you|could you|please)\s+/i,
  /^(?:add|create|set|start|begin)\s+(?:me\s+)?(?:a\s+)?reminder(?:\s+to|\s+for)?\s+/i,
  /^(?:remind me(?:\s+to)?|alert me(?:\s+to)?|notify me(?:\s+to)?)\s+/i,
  /^(?:add|create|write|jot)\s+(?:a\s+)?note(?:\s+that)?\s+/i,
  /^(?:note that|remember that)\s+/i,
  /^(?:add|create|start|begin|delete|remove|cancel|complete|finish|finished|mark|skip|stop|snooze|update)\s+/i,
];

function normalizeWhitespace(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function splitWords(value = "") {
  return normalizeWhitespace(value).split(" ").filter(Boolean);
}

function collapseConsecutiveWordRepeats(text = "") {
  const words = splitWords(text);
  const compact = [];

  for (const word of words) {
    const normalizedWord = word.toLowerCase();
    const previousWord = compact[compact.length - 1]?.toLowerCase();
    if (normalizedWord && normalizedWord === previousWord) {
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
    const beforeTail = words.slice(-phraseSize * 2, -phraseSize).join(" ").toLowerCase();
    if (tail && tail === beforeTail) {
      return words.slice(0, -phraseSize).join(" ");
    }
  }

  return words.join(" ");
}

function sanitizeSpokenText(text = "") {
  return normalizeWhitespace(collapseRepeatedTailPhrases(collapseConsecutiveWordRepeats(text)));
}

function trimQuotes(value = "") {
  return normalizeWhitespace(value.replace(/^["'\s]+|["'\s]+$/g, ""));
}

function removeDateAndTimeFragments(text = "") {
  return trimQuotes(
    text
      .replace(TIME_FRAGMENT_PATTERN, " ")
      .replace(/\b(?:a\.?m\.?|p\.?m\.?|am|pm)\b/gi, " ")
      .replace(DATE_FRAGMENT_PATTERN, " ")
      .replace(REPEAT_FRAGMENT_PATTERN, " ")
      .replace(/\s+,/g, ",")
      .replace(/\s+[,.!?]/g, " ")
      .replace(/[,.!?]\s*[,.!?]+/g, " ")
      .replace(/[,.!?]+$/g, "")
      .replace(/\s{2,}/g, " ")
  );
}

function detectAction(normalizedText) {
  for (const entry of ACTION_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(normalizedText))) {
      return entry.action;
    }
  }
  return "create";
}

function detectEntity(normalizedText, action) {
  if (REFERENCE_PATTERN.test(normalizedText) && action !== "create") {
    return "last";
  }

  for (const [entityType, patterns] of Object.entries(ENTITY_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(normalizedText))) {
      return entityType;
    }
  }

  if (["snooze", "stop"].includes(action)) {
    return "reminder";
  }

  if (["complete", "skip"].includes(action)) {
    return "habit";
  }

  if (action === "undo") {
    return "last";
  }

  return "habit";
}

function guessRepeat(normalizedText) {
  const matched = REPEAT_PATTERNS.find((entry) => entry.pattern.test(normalizedText));
  return matched ? matched.repeat : "none";
}

function extractTime(normalizedText) {
  const explicitMatch = normalizedText.match(/\b(?:at|around|by|for)?\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)/i);
  if (explicitMatch) {
    return parseTimeTo24Hour(explicitMatch[1].replace(/\./g, ""));
  }

  if (/\bmorning\b/i.test(normalizedText)) {
    return "08:00";
  }
  if (/\bevening\b/i.test(normalizedText)) {
    return "19:00";
  }
  if (/\bnight\b/i.test(normalizedText)) {
    return "21:00";
  }
  return "";
}

function extractRawContent(rawText, action, entityType) {
  let content = sanitizeSpokenText(rawText);

  let previous = "";
  while (content && content !== previous) {
    previous = content;
    content = content
      .replace(LEADING_FILLERS_PATTERN, "")
      .replace(/^(?:a|an|the)\s+/i, "");

    COMMAND_PREFIX_PATTERNS.forEach((pattern) => {
      content = content.replace(pattern, "");
    });
  }

  content = content
    .replace(/\b(?:habit|task|note|reminder)\b/gi, " ")
    .replace(/^(?:me|to|for|that)\s+/i, "");

  if (action === "complete") {
    content = content.replace(/\b(?:done|completed|finished)\b/gi, " ");
  }

  if (action === "delete") {
    content = content.replace(/\b(?:it|that|this|last one|last task|that task|that one)\b/gi, " ");
  }

  if (action !== "create" && REFERENCE_PATTERN.test(content)) {
    return "";
  }

  content = removeDateAndTimeFragments(content);
  content = content
    .replace(/^(?:to|for|about|that)\s+/i, "")
    .replace(/^(?:i need to|i have to|need to|have to)\s+/i, "");

  if (entityType === "note" && /^that\s+/i.test(content)) {
    content = content.replace(/^that\s+/i, "");
  }

  return trimQuotes(sanitizeSpokenText(content));
}

function extractTarget(rawText, action, entityType) {
  const content = extractRawContent(rawText, action, entityType);

  if (!content || REFERENCE_PATTERN.test(content)) {
    return "";
  }

  if (entityType === "note") {
    return content.slice(0, 80);
  }

  const compact = content.match(/[A-Za-z0-9][A-Za-z0-9\s-]{0,80}/);
  return trimQuotes(compact ? compact[0] : content);
}

function buildCommand(overrides = {}) {
  return {
    action: "create",
    entityType: "habit",
    target: "",
    content: "",
    date: "",
    time: "",
    repeat: "none",
    rawText: "",
    confidence: 0.55,
    ...overrides,
  };
}

function computeConfidence({ action, entityType, target, date, time, repeat, rawText }) {
  let score = 0.5;
  if (action && action !== "create") {
    score += 0.12;
  }
  if (entityType && entityType !== "last") {
    score += 0.12;
  }
  if (target) {
    score += 0.12;
  }
  if (date) {
    score += 0.05;
  }
  if (time) {
    score += 0.05;
  }
  if (repeat && repeat !== "none") {
    score += 0.05;
  }
  if (entityType === "last" || !target) {
    score -= 0.1;
  }
  if ((rawText || "").split(/\s+/).length >= 10) {
    score -= 0.05;
  }
  return Math.max(0.4, Math.min(0.95, Number(score.toFixed(2))));
}

function fallbackParse(text) {
  const rawText = sanitizeSpokenText(text || "");
  const normalized = rawText.toLowerCase().replace(/\./g, "");

  if (!rawText) {
    return buildCommand({ rawText });
  }

  const action = detectAction(normalized);
  const entityType = detectEntity(normalized, action);
  const date = parseRelativeDate(normalized);
  const time = extractTime(normalized);
  const repeat = guessRepeat(normalized);
  const target = extractTarget(rawText, action, entityType);
  const content = extractRawContent(rawText, action, entityType) || target;

  return buildCommand({
    action,
    entityType,
    target,
    content,
    date,
    time,
    repeat,
    rawText,
    confidence: computeConfidence({ action, entityType, target, date, time, repeat, rawText }),
  });
}

function sanitizeModelResponse(rawText) {
  return rawText.replace(/```json|```/gi, "").trim();
}

function shouldUseAi(command) {
  const wordCount = (command.rawText || "").split(/\s+/).filter(Boolean).length;
  return Boolean(process.env.GEMINI_API_KEY) && (command.confidence < 0.7 || wordCount >= 10);
}

function splitCompoundCommands(text = "") {
  const raw = normalizeWhitespace(text);
  if (!raw) {
    return [];
  }

  const segments = raw
    .split(/\s+(?:and then|then|and)\s+/i)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  if (segments.length <= 1) {
    return [raw];
  }

  const actionLikeSegments = segments.filter((segment) =>
    /\b(add|create|start|begin|delete|remove|cancel|complete|done|finished|mark|skip|stop|snooze|update|remind|note)\b/i.test(segment)
  );

  return actionLikeSegments.length >= 2 ? segments : [raw];
}

async function generateGeminiJson(prompt) {
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelCandidates = [
    process.env.GEMINI_MODEL,
    "gemini-2.0-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-8b",
  ].filter(Boolean);

  let lastError;
  for (const modelName of [...new Set(modelCandidates)]) {
    try {
      const model = client.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return JSON.parse(sanitizeModelResponse(response.text()));
    } catch (error) {
      lastError = error;
      if (!String(error.message || "").includes("404")) {
        break;
      }
    }
  }

  throw lastError || new Error("Gemini request failed");
}

async function refineCommandWithGemini(text, baseCommand, options = {}) {
  const prompt = `
Refine this structured voice command for a productivity assistant.
Return only valid JSON with keys:
action, entityType, target, content, date, time, repeat, confidence

Rules:
- Keep already-correct fields.
- Only change action/entityType if allowIntentRefine is true and the current one is clearly wrong.
- Preserve the natural target phrase.
- Normalize date to YYYY-MM-DD and time to HH:MM when possible.
- Do not invent data.

allowIntentRefine: ${options.allowIntentRefine ? "true" : "false"}
Current command: ${JSON.stringify(baseCommand)}
Raw speech: "${text}"
`;

  return generateGeminiJson(prompt);
}

async function parseCommand(text) {
  const baseCommand = fallbackParse(text);
  if (!shouldUseAi(baseCommand)) {
    return { source: "rule-engine", command: baseCommand };
  }

  try {
    const refined = await refineCommandWithGemini(text, baseCommand, {
      allowIntentRefine: baseCommand.confidence < 0.6,
    });

    return {
      source: "hybrid-ai",
      command: buildCommand({
        ...baseCommand,
        ...refined,
        rawText: baseCommand.rawText,
        confidence: Math.max(Number(refined.confidence || 0), baseCommand.confidence, 0.75),
      }),
    };
  } catch (_error) {
    return { source: "rule-engine", command: baseCommand };
  }
}

module.exports = {
  fallbackParse,
  parseCommand,
  splitCompoundCommands,
  refineCommandWithGemini,
  removeDateAndTimeFragments,
  extractTarget,
  extractRawContent,
};
