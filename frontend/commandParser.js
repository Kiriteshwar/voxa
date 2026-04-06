(function commandParserModule() {
  const CACHE_KEY = "voxa_command_cache_v3";
  const REFERENCE_PATTERN = /\b(it|that|this|last one|last task|that task|that one)\b/i;
  const TIME_FRAGMENT_PATTERN = /\b(?:at|around|by|for)?\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?\b/gi;
  const DATE_FRAGMENT_PATTERN = /\b(today|tomorrow|tonight|this weekend|next week)\b/gi;
  const REPEAT_FRAGMENT_PATTERN = /\b(every day|daily|every week|weekly|every morning|every evening)\b/gi;

  function normalizeWhitespace(value = "") {
    return value.replace(/\s+/g, " ").trim();
  }

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

  function removeDateAndTimeFragments(text = "") {
    return normalizeWhitespace(
      text
        .replace(TIME_FRAGMENT_PATTERN, " ")
        .replace(/\b(?:a\.?m\.?|p\.?m\.?|am|pm)\b/gi, " ")
        .replace(DATE_FRAGMENT_PATTERN, " ")
        .replace(REPEAT_FRAGMENT_PATTERN, " ")
        .replace(/\s+[,.!?]/g, " ")
        .replace(/[,.!?]+$/g, "")
    );
  }

  function detectAction(normalizedText) {
    if (/\b(delete|remove|cancel)\b/i.test(normalizedText)) {
      return "delete";
    }
    if (/\b(complete|completed|done|finished)\b/i.test(normalizedText) || /\bmark\b.*\bdone\b/i.test(normalizedText)) {
      return "complete";
    }
    if (/\bskip\b/i.test(normalizedText)) {
      return "skip";
    }
    if (/\b(update|change|move|reschedule)\b/i.test(normalizedText)) {
      return "update";
    }
    if (/\b(undo|restore|do it again)\b/i.test(normalizedText)) {
      return "undo";
    }
    if (/\bsnooze\b/i.test(normalizedText)) {
      return "snooze";
    }
    if (/\b(stop|dismiss)\b/i.test(normalizedText)) {
      return "stop";
    }
    return "create";
  }

  function detectEntity(normalizedText, action) {
    if (REFERENCE_PATTERN.test(normalizedText) && action !== "create") {
      return "last";
    }
    if (/\b(note|write|remember|jot)\b/i.test(normalizedText)) {
      return "note";
    }
    if (/\b(remind|reminder|alert|notify)\b/i.test(normalizedText)) {
      return "reminder";
    }
    if (action === "undo") {
      return "last";
    }
    return "habit";
  }

  function detectDate(normalizedText) {
    const now = new Date();
    if (/\btomorrow\b/i.test(normalizedText)) {
      const next = new Date(now);
      next.setDate(now.getDate() + 1);
      return next.toISOString().slice(0, 10);
    }
    if (/\btoday\b/i.test(normalizedText)) {
      return now.toISOString().slice(0, 10);
    }
    return "";
  }

  function detectTime(normalizedText) {
    const explicitMatch = normalizedText.match(/\b(?:at|around|by|for)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)?/i);
    if (!explicitMatch) {
      if (/\bmorning\b/i.test(normalizedText)) {
        return "08:00";
      }
      if (/\bevening\b/i.test(normalizedText)) {
        return "19:00";
      }
      return "";
    }

    let hour = Number(explicitMatch[1]);
    const minute = explicitMatch[2] || "00";
    const meridiem = (explicitMatch[3] || "").toLowerCase().replace(/\./g, "");

    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    }
    if (meridiem === "am" && hour === 12) {
      hour = 0;
    }

    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  function detectRepeat(normalizedText) {
    if (/\bevery day\b|\bdaily\b|\bevery morning\b|\bevery evening\b/i.test(normalizedText)) {
      return "daily";
    }
    if (/\bevery week\b|\bweekly\b/i.test(normalizedText)) {
      return "weekly";
    }
    return "none";
  }

  function extractContent(rawText, action, entityType) {
    let content = normalizeWhitespace(rawText);
    content = content
      .replace(/^(?:hey|please|bro|ok|okay)\s+/i, "")
      .replace(/^(?:i want to|can you|could you)\s+/i, "")
      .replace(/^(?:add|create|start|begin|delete|remove|cancel|complete|finished|finish|mark|skip|stop|snooze|update)\s+/i, "")
      .replace(/^(?:a|an|the)\s+/i, "")
      .replace(/\b(?:habit|task|note|reminder)\b/gi, " ");

    if (action === "complete") {
      content = content.replace(/\b(?:done|completed|finished)\b/gi, " ");
    }

    if (action !== "create" && REFERENCE_PATTERN.test(content)) {
      return "";
    }

    content = removeDateAndTimeFragments(content);
    if (entityType === "note") {
      content = content.replace(/^that\s+/i, "");
    }

    return normalizeWhitespace(content);
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
      confidence: 0.5,
      ...overrides,
    };
  }

  function quickParse(rawText) {
    const input = normalizeWhitespace(rawText || "");
    const cache = readCache();
    const cached = cache[input.toLowerCase()];
    if (cached) {
      return cached;
    }

    const normalized = input.toLowerCase().replace(/\./g, "");
    const action = detectAction(normalized);
    const entityType = detectEntity(normalized, action);
    const content = extractContent(input, action, entityType);
    const target = content;
    const date = detectDate(normalized);
    const time = detectTime(normalized);
    const repeat = detectRepeat(normalized);

    let confidence = 0.52;
    if (action !== "create") confidence += 0.12;
    if (entityType !== "last") confidence += 0.1;
    if (target) confidence += 0.12;
    if (date) confidence += 0.05;
    if (time) confidence += 0.05;
    if (repeat !== "none") confidence += 0.05;
    if (entityType === "last") confidence -= 0.1;

    const result = buildCommand({
      action,
      entityType,
      target,
      content,
      date,
      time,
      repeat,
      rawText: input,
      confidence: Math.max(0.4, Math.min(0.9, Number(confidence.toFixed(2)))),
    });

    cache[input.toLowerCase()] = result;
    writeCache(cache);
    return result;
  }

  function shouldUseAiAssist(command) {
    const wordCount = (command.rawText || "").split(/\s+/).filter(Boolean).length;
    return command.confidence < 0.7 || wordCount >= 10;
  }

  function formatPreview(preview) {
    const understood = preview.understood || {};
    const confidence = preview.confidence || preview.command?.confidence || 0;

    return {
      headline: understood.headline || `${preview.command.action} ${preview.command.entityType}`,
      actionLabel: understood.actionLabel || preview.command.action,
      entityLabel: understood.entityLabel || preview.command.entityType,
      targetLabel: understood.targetLabel || preview.command.target || preview.command.content || "",
      details: understood.details || [],
      suggestion: understood.suggestion || "",
      confidence,
      confidenceLabel: `${Math.round(confidence * 100)}% confidence`,
      confidenceTone: confidence >= 0.9 ? "high" : confidence >= 0.7 ? "medium" : "low",
      message:
        confidence < 0.7
          ? "I'm not fully sure yet. Please review this."
          : confidence < 0.9
            ? "This looks close, but I want you to confirm it."
            : "This looks good to me.",
    };
  }

  window.voxaCommandParser = {
    quickParse,
    parse: quickParse,
    removeDateAndTimeFragments,
    shouldUseAiAssist,
    formatPreview,
  };
})();
