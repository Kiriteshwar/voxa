(function commandParserModule() {
  const CACHE_KEY = "voxa_command_cache_v2";
  const DEFAULT_CATEGORY = "general";
  const CATEGORY_ALIASES = {
    general: ["general"],
    money: ["money", "finance", "financial", "payment", "cash"],
    expense: ["expense", "expenses", "spent", "spend", "cost", "bill", "bills"],
    personal: ["personal", "family", "mom", "dad", "friend", "home"],
    work: ["work", "office", "client", "project", "meeting", "job"],
    study: ["study", "exam", "school", "college", "class", "homework"],
    health: ["health", "gym", "workout", "fitness", "medicine", "doctor", "water"],
  };
  const TIME_PHRASES = {
    morning: "08:00",
    early_morning: "06:00",
    afternoon: "14:00",
    evening: "19:00",
    night: "21:00",
    tonight: "21:00",
    noon: "12:00",
    midnight: "00:00",
    "after lunch": "14:00",
    "after dinner": "20:30",
    "after breakfast": "09:00",
    later: "18:00",
  };
  const FILLER_PATTERNS = [
    /\bhey\b/gi,
    /\bbro\b/gi,
    /\bplease\b/gi,
    /\bmaybe\b/gi,
    /\bjust\b/gi,
    /\bkind of\b/gi,
    /\bsort of\b/gi,
    /\bi think\b/gi,
    /\bi guess\b/gi,
    /\bi feel like\b/gi,
    /\bi want to\b/gi,
    /\bi would like to\b/gi,
    /\bcan you\b/gi,
    /\bcould you\b/gi,
    /\bfor me\b/gi,
  ];
  const CONVERSATIONAL_PATTERNS = [
    /\bi think\b/i,
    /\bi need to\b/i,
    /\bi should\b/i,
    /\bi want to\b/i,
    /\bmaybe\b/i,
    /\bfrom tomorrow\b/i,
    /\baround\b/i,
    /\blater\b/i,
  ];
  const TYPE_KEYWORDS = {
    note: [
      "note",
      "write",
      "write down",
      "jot",
      "remember this",
      "remember that",
      "expense note",
      "money note",
      "personal note",
      "work note",
    ],
    reminder: [
      "remind",
      "alert",
      "ping me",
      "don't let me forget",
      "notify me",
    ],
    schedule: [
      "schedule",
      "meeting",
      "calendar",
      "appointment",
      "plan",
      "call with",
      "set up a meeting",
      "book",
    ],
    habit: [
      "habit",
      "daily",
      "every day",
      "every morning",
      "every evening",
      "routine",
      "start going",
      "from tomorrow",
      "workout",
      "gym",
      "meditate",
      "study daily",
    ],
  };

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  }

  function writeCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_error) {
      return;
    }
  }

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function stripFillers(text) {
    return normalizeWhitespace(
      FILLER_PATTERNS.reduce((current, pattern) => current.replace(pattern, " "), text)
    );
  }

  function toIsoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;
  }

  function nextWeekday(dayIndex) {
    const date = new Date();
    const difference = (dayIndex + 7 - date.getDay()) % 7 || 7;
    date.setDate(date.getDate() + difference);
    return toIsoDate(date);
  }

  function parseExplicitTime(text) {
    const match = text.match(/\b(?:at|around|by)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (!match) {
      return "";
    }

    let hour = Number(match[1]);
    const minute = match[2] || "00";
    const meridiem = match[3] ? match[3].toLowerCase() : "";

    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    }

    if (meridiem === "am" && hour === 12) {
      hour = 0;
    }

    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  function detectTime(text) {
    const normalized = text.toLowerCase();
    const explicit = parseExplicitTime(normalized);
    if (explicit) {
      return explicit;
    }

    const matchedPhrase = Object.keys(TIME_PHRASES).find((phrase) => normalized.includes(phrase));
    return matchedPhrase ? TIME_PHRASES[matchedPhrase] : "";
  }

  function detectDate(text) {
    const normalized = text.toLowerCase();
    const today = new Date();

    if (normalized.includes("day after tomorrow")) {
      const value = new Date(today);
      value.setDate(value.getDate() + 2);
      return toIsoDate(value);
    }

    if (normalized.includes("tomorrow")) {
      const value = new Date(today);
      value.setDate(value.getDate() + 1);
      return toIsoDate(value);
    }

    if (normalized.includes("today")) {
      return toIsoDate(today);
    }

    if (normalized.includes("this weekend") || normalized.includes("weekend")) {
      return nextWeekday(6);
    }

    if (normalized.includes("next week")) {
      const value = new Date(today);
      value.setDate(value.getDate() + 7);
      return toIsoDate(value);
    }

    const weekdays = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const weekdayMatch = Object.keys(weekdays).find((weekday) => normalized.includes(weekday));
    if (weekdayMatch) {
      return nextWeekday(weekdays[weekdayMatch]);
    }

    const isoMatch = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    return isoMatch ? isoMatch[1] : "";
  }

  function detectRepeat(text) {
    const normalized = text.toLowerCase();

    if (
      normalized.includes("every day") ||
      normalized.includes("daily") ||
      normalized.includes("every morning") ||
      normalized.includes("every evening")
    ) {
      return "daily";
    }

    if (normalized.includes("every week") || normalized.includes("weekly")) {
      return "weekly";
    }

    const weekdayPattern = normalized.match(/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (weekdayPattern) {
      return `weekly:${weekdayPattern[1]}`;
    }

    if (normalized.includes("weekdays")) {
      return "weekdays";
    }

    return "";
  }

  function detectAction(text) {
    const normalized = text.toLowerCase();

    if (
      normalized.includes("delete") ||
      normalized.includes("remove") ||
      normalized.includes("cancel")
    ) {
      return "delete";
    }

    if (
      normalized.includes("complete") ||
      normalized.includes("mark") && normalized.includes("done") ||
      normalized.includes("finished")
    ) {
      return "complete";
    }

    if (
      normalized.includes("update") ||
      normalized.includes("change") ||
      normalized.includes("move") ||
      normalized.includes("reschedule")
    ) {
      return "update";
    }

    return "add";
  }

  function scoreType(text) {
    const normalized = text.toLowerCase();
    const scores = { note: 0, reminder: 0, schedule: 0, habit: 0 };

    Object.entries(TYPE_KEYWORDS).forEach(([type, keywords]) => {
      keywords.forEach((keyword) => {
        if (normalized.includes(keyword)) {
          scores[type] += keyword.includes(" ") ? 2 : 1;
        }
      });
    });

    if (/\bnote\b/.test(normalized)) {
      scores.note += 3;
    }

    if (/\bremind me\b/.test(normalized)) {
      scores.reminder += 3;
    }

    if (/\bmeeting\b/.test(normalized) || /\bschedule\b/.test(normalized)) {
      scores.schedule += 3;
    }

    if (/\bevery day\b/.test(normalized) || /\bdaily\b/.test(normalized)) {
      scores.habit += 2;
    }

    const sorted = Object.entries(scores).sort((left, right) => right[1] - left[1]);
    const [type, score] = sorted[0];
    const secondScore = sorted[1][1];
    const confidence = score === 0 ? 0.35 : Math.min(0.95, 0.45 + (score - secondScore) * 0.15);

    if (score === 0) {
      return { type: "habit", confidence: 0.35 };
    }

    return { type, confidence };
  }

  function detectCategory(text) {
    const normalized = text.toLowerCase();
    const directMatch = normalized.match(/\b(?:under|in|into)\s+([a-z]+)\s+note\b/);
    if (directMatch && CATEGORY_ALIASES[directMatch[1]]) {
      return directMatch[1];
    }

    const category = Object.entries(CATEGORY_ALIASES).find(([, aliases]) =>
      aliases.some((alias) => normalized.includes(alias))
    );

    return category ? category[0] : DEFAULT_CATEGORY;
  }

  function cleanTitle(text, context) {
    const cleaned = stripFillers(text)
      .replace(/\bplease\b/gi, " ")
      .replace(/\bkindly\b/gi, " ")
      .replace(/\bfor me\b/gi, " ")
      .replace(/\s+/g, " ");

    const patterns = [
      /\bunder\s+[a-z]+\s+note\b/gi,
      /\bin\s+[a-z]+\s+note\b/gi,
      /\b(?:add|create|make|save|write|jot)\s+(?:a\s+|an\s+)?(?:new\s+)?/gi,
      /\b(?:note|habit|reminder|meeting|schedule|event)\b/gi,
      /\bthat\s+i\s+need\s+to\b/gi,
      /\bthat\b/gi,
      /\bplease\b/gi,
      /\bfor tomorrow\b/gi,
      /\bfrom tomorrow\b/gi,
      /\btomorrow\b/gi,
      /\btoday\b/gi,
      /\bthis weekend\b/gi,
      /\bnext week\b/gi,
      /\blater\b/gi,
      /\bevery day\b/gi,
      /\bdaily\b/gi,
      /\bevery morning\b/gi,
      /\bevery evening\b/gi,
      /\bafter dinner\b/gi,
      /\bmorning\b/gi,
      /\bevening\b/gi,
      /\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/gi,
      /\baround\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/gi,
    ];

    let title = patterns.reduce((current, pattern) => current.replace(pattern, " "), cleaned);

    if (context.type === "note") {
      title = title
        .replace(/\bremember\b/gi, " ")
        .replace(/\badd that\b/gi, " ")
        .replace(/\bi need to\b/gi, "")
        .replace(/\bi spent\b/gi, "spent");
    }

    if (context.type === "reminder") {
      title = title
        .replace(/\bremind me\b/gi, " ")
        .replace(/\balert me\b/gi, " ")
        .replace(/^\s*to\s+/i, " ");
    }

    if (context.type === "schedule") {
      title = title
        .replace(/\bschedule\b/gi, " ")
        .replace(/\bset up\b/gi, " ")
        .replace(/\bbook\b/gi, " ")
        .replace(/\bwith\b/gi, "with ");
    }

    if (context.type === "habit") {
      title = title
        .replace(/\bi should\b/gi, " ")
        .replace(/\bstart\b/gi, " ")
        .replace(/\bgoing to\b/gi, " ")
        .replace(/\bgo to\b/gi, " ")
        .replace(/\bdo\b/gi, " ")
        .replace(/\bi want to\b/gi, " ");
    }

    title = normalizeWhitespace(title);
    title = title.replace(/^(a|an)\s+/i, "");

    if (
      context.type === "note" &&
      context.category &&
      context.category !== DEFAULT_CATEGORY &&
      title.toLowerCase().startsWith(`${context.category} `)
    ) {
      title = title.slice(context.category.length + 1);
    }

    if (context.type === "schedule" && title.startsWith("with ")) {
      title = `meeting ${title}`;
    }

    if (context.type === "habit") {
      const habitMatch =
        title.match(/\b(gym|study|meditate|work out|workout|run|jog|read|drink water|walk)\b/i) ||
        title.match(/\b([a-z0-9][a-z0-9 ]{1,40})\b/i);
      title = habitMatch ? normalizeWhitespace(habitMatch[0]) : title;
    }

    return title || normalizeWhitespace(cleaned);
  }

  function buildStructuredSummary(result) {
    const parts = [`${result.action} ${result.type}`];

    if (result.category && result.category !== DEFAULT_CATEGORY) {
      parts.push(`category ${result.category}`);
    }

    parts.push(`title "${result.title}"`);

    if (result.date) {
      parts.push(`date ${result.date}`);
    }

    if (result.time) {
      parts.push(`time ${result.time}`);
    }

    if (result.repeat) {
      parts.push(`repeat ${result.repeat}`);
    }

    return parts.join(" | ");
  }

  function shouldUseAi(result, normalizedText) {
    const wordCount = normalizedText.split(" ").filter(Boolean).length;
    const conversational = CONVERSATIONAL_PATTERNS.some((pattern) => pattern.test(normalizedText));
    const lowConfidence = result.confidence < 0.7;
    const longSentence = wordCount >= 9;
    const weakExtraction = result.title.length < 4 || (!result.time && !result.date && conversational);

    return lowConfidence || longSentence || weakExtraction;
  }

  async function refineWithAi(baseResult, rawText) {
    if (!window.voxaApi?.refineVoiceCommand) {
      return baseResult;
    }

    try {
      const refined = await window.voxaApi.refineVoiceCommand(rawText, baseResult, {
        allowIntentRefine: baseResult.confidence < 0.55,
      });

      return {
        ...baseResult,
        title: refined.title || baseResult.title,
        time: refined.time || baseResult.time,
        date: refined.date || baseResult.date,
        repeat: refined.repeat || baseResult.repeat,
        type: refined.type || baseResult.type,
        category: refined.category || baseResult.category,
        confidence: Math.max(baseResult.confidence, 0.75),
      };
    } catch (_error) {
      return baseResult;
    }
  }

  async function parse(rawText) {
    const input = normalizeWhitespace(rawText || "");
    const cache = readCache();
    const cached = cache[input.toLowerCase()];
    if (cached) {
      return cached;
    }

    const normalized = stripFillers(input);
    const typeResult = scoreType(normalized);
    const action = detectAction(normalized);
    const category = typeResult.type === "note" ? detectCategory(normalized) : DEFAULT_CATEGORY;
    const time = detectTime(normalized);
    const date = detectDate(normalized);
    const repeat = detectRepeat(normalized);
    const title = cleanTitle(normalized, { type: typeResult.type, action, category });

    let result = {
      type: typeResult.type,
      action,
      title,
      category,
      time,
      date,
      repeat,
      confidence: typeResult.confidence,
      rawText: input,
    };

    if (shouldUseAi(result, normalized)) {
      result = await refineWithAi(result, input);
    }

    result.summary = buildStructuredSummary(result);

    cache[input.toLowerCase()] = result;
    const trimmedEntries = Object.entries(cache).slice(-25);
    writeCache(Object.fromEntries(trimmedEntries));

    return result;
  }

  const examples = [
    "under money note add that 450 need to be given to ChatGPT",
    "create a personal note that I need to call mom",
    "remind me tomorrow evening to study",
    "schedule a meeting with Rahul at 5 pm",
    "I spent 200 on food add that in expense note",
    "add gym every day at 6",
    "bro from tomorrow I think I should go to gym daily in the morning around 6",
  ];

  window.voxaCommandParser = {
    parse,
    examples,
    helpers: {
      detectTime,
      detectDate,
      detectRepeat,
      detectCategory,
      detectAction,
    },
  };
})();
