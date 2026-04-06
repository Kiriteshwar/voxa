const { GoogleGenerativeAI } = require("@google/generative-ai");
const { parseTimeTo24Hour, parseRelativeDate } = require("./date");

function trimQuotes(value = "") {
  return value.replace(/^["'\s]+|["'\s]+$/g, "").trim();
}

function guessRepeat(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes("every day") || normalized.includes("daily")) {
    return "daily";
  }
  if (normalized.includes("every week") || normalized.includes("weekly")) {
    return "weekly";
  }
  return "none";
}

function extractTime(text) {
  const timeMatch = text.match(/\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  return parseTimeTo24Hour(timeMatch ? timeMatch[1] : "");
}

function extractContentAfterPrefix(text, prefixes) {
  for (const prefix of prefixes) {
    if (text.toLowerCase().startsWith(prefix)) {
      return trimQuotes(text.slice(prefix.length));
    }
  }
  return trimQuotes(text);
}

function removeDateAndTimeFragments(text) {
  return trimQuotes(
    text
      .replace(/\b(today|tomorrow)\b/gi, "")
      .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/gi, "")
      .replace(/\bevery day\b/gi, "")
      .replace(/\bdaily\b/gi, "")
      .replace(/\bevery week\b/gi, "")
      .replace(/\bweekly\b/gi, "")
  );
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
    ...overrides,
  };
}

function fallbackParse(text) {
  const rawText = (text || "").trim();
  const normalized = rawText.toLowerCase();
  const date = parseRelativeDate(normalized);
  const time = extractTime(normalized);
  const repeat = guessRepeat(normalized);

  if (!rawText) {
    return buildCommand({ rawText });
  }

  if (normalized.startsWith("create note") || normalized.startsWith("add note")) {
    const content = extractContentAfterPrefix(normalized, ["create note", "add note"]);
    return buildCommand({
      action: "create",
      entityType: "note",
      content,
      target: content,
      rawText,
    });
  }

  if (normalized.startsWith("delete note")) {
    const target = extractContentAfterPrefix(normalized, ["delete note"]);
    return buildCommand({
      action: "delete",
      entityType: "note",
      target,
      rawText,
    });
  }

  if (normalized.startsWith("remind me to") || normalized.startsWith("create reminder")) {
    const content = removeDateAndTimeFragments(
      extractContentAfterPrefix(normalized, ["remind me to", "create reminder"])
    );
    return buildCommand({
      action: "create",
      entityType: "reminder",
      content,
      target: content,
      date,
      time,
      repeat,
      rawText,
    });
  }

  if (normalized.startsWith("snooze")) {
    const target = removeDateAndTimeFragments(extractContentAfterPrefix(normalized, ["snooze"]));
    return buildCommand({
      action: "snooze",
      entityType: "reminder",
      target,
      time,
      rawText,
    });
  }

  if (normalized.startsWith("stop reminder") || normalized.startsWith("stop")) {
    const target = extractContentAfterPrefix(normalized, ["stop reminder", "stop"]);
    return buildCommand({
      action: "stop",
      entityType: "reminder",
      target,
      rawText,
    });
  }

  if (normalized.startsWith("mark ") && (normalized.endsWith(" done") || normalized.endsWith(" completed"))) {
    const target = normalized.replace(/^mark\s+/i, "").replace(/\s+(done|completed)$/i, "").trim();
    return buildCommand({
      action: "complete",
      entityType: "habit",
      target,
      date,
      rawText,
    });
  }

  if (normalized.startsWith("skip ")) {
    const target = extractContentAfterPrefix(normalized, ["skip"]);
    return buildCommand({
      action: "skip",
      entityType: "habit",
      target,
      date,
      rawText,
    });
  }

  if (normalized.startsWith("delete habit")) {
    const target = extractContentAfterPrefix(normalized, ["delete habit"]);
    return buildCommand({
      action: "delete",
      entityType: "habit",
      target,
      rawText,
    });
  }

  if (normalized.startsWith("delete reminder")) {
    const target = extractContentAfterPrefix(normalized, ["delete reminder"]);
    return buildCommand({
      action: "delete",
      entityType: "reminder",
      target,
      rawText,
    });
  }

  if (normalized.startsWith("delete ")) {
    const target = extractContentAfterPrefix(normalized, ["delete"]);
    return buildCommand({
      action: "delete",
      entityType: "habit",
      target,
      rawText,
    });
  }

  if (normalized.startsWith("add habit") || normalized.startsWith("create habit")) {
    const target = removeDateAndTimeFragments(
      extractContentAfterPrefix(normalized, ["add habit", "create habit"])
    );
    return buildCommand({
      action: "create",
      entityType: "habit",
      target,
      content: target,
      date,
      time,
      repeat: repeat === "none" ? "daily" : repeat,
      rawText,
    });
  }

  return buildCommand({
    action: "create",
    entityType: "habit",
    target: removeDateAndTimeFragments(rawText),
    content: removeDateAndTimeFragments(rawText),
    date,
    time,
    repeat: repeat === "none" ? "daily" : repeat,
    rawText,
  });
}

function sanitizeModelResponse(rawText) {
  return rawText.replace(/```json|```/gi, "").trim();
}

async function generateGeminiJson(prompt) {
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelCandidates = [
    process.env.GEMINI_MODEL,
    "gemini-2.0-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-8b",
  ].filter(Boolean);
  const uniqueModels = [...new Set(modelCandidates)];
  let lastError;

  for (const modelName of uniqueModels) {
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

async function parseWithGemini(text) {
  const prompt = `
Convert a voice command for a habit tracker app into JSON.
Return only valid JSON with keys:
action, entityType, target, content, date, time, repeat, rawText

Rules:
- action: create, complete, skip, delete, snooze, stop, update
- entityType: habit, note, reminder
- target: short name of the habit/note/reminder
- content: full free-text content if useful
- date: YYYY-MM-DD or empty string
- time: HH:MM 24-hour or empty string
- repeat: daily, weekly, custom, none
- rawText: original command

Examples:
"Add habit gym at 6 am" => {"action":"create","entityType":"habit","target":"gym","content":"gym","date":"","time":"06:00","repeat":"daily","rawText":"Add habit gym at 6 am"}
"Mark gym done" => {"action":"complete","entityType":"habit","target":"gym","content":"","date":"","time":"","repeat":"none","rawText":"Mark gym done"}
"Create note buy groceries" => {"action":"create","entityType":"note","target":"buy groceries","content":"buy groceries","date":"","time":"","repeat":"none","rawText":"Create note buy groceries"}
"Remind me to study at 9 pm" => {"action":"create","entityType":"reminder","target":"study","content":"study","date":"","time":"21:00","repeat":"none","rawText":"Remind me to study at 9 pm"}

Input: "${text}"
`;

  return generateGeminiJson(prompt);
}

async function refineCommandWithGemini(text, baseCommand, options = {}) {
  const prompt = `
Refine a structured productivity voice command.
Return only valid JSON with keys:
type, action, title, category, date, time, repeat, confidence

Rules:
- Keep correct rule-based fields intact.
- Only change "type" if allowIntentRefine is true and the current type is clearly wrong.
- Do not remove already-correct date/time/repeat values.
- Normalize time to HH:MM 24-hour when possible.
- Normalize date to YYYY-MM-DD when possible.
- category should stay "general" unless the text clearly implies another category.
- confidence should be a number between 0 and 1.

allowIntentRefine: ${options.allowIntentRefine ? "true" : "false"}
Current structured command: ${JSON.stringify(baseCommand)}
Raw speech: "${text}"
`;

  return generateGeminiJson(prompt);
}

async function parseCommand(text) {
  if (!process.env.GEMINI_API_KEY) {
    return { source: "fallback", command: fallbackParse(text) };
  }

  try {
    const parsed = await parseWithGemini(text);
    return { source: "gemini", command: buildCommand(parsed) };
  } catch (error) {
    return { source: "fallback", command: fallbackParse(text) };
  }
}

module.exports = {
  parseCommand,
  fallbackParse,
  refineCommandWithGemini,
};
