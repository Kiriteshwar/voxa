function pad(value) {
  return String(value).padStart(2, "0");
}

function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeKey(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseTimeTo24Hour(text) {
  if (!text) {
    return "";
  }

  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
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

  if (hour > 23 || Number(minute) > 59) {
    return "";
  }

  return `${pad(hour)}:${minute}`;
}

function parseRelativeDate(text, now = new Date()) {
  const normalized = (text || "").toLowerCase();
  const date = new Date(now);

  if (normalized.includes("tomorrow")) {
    date.setDate(date.getDate() + 1);
    return toDateKey(date);
  }

  if (normalized.includes("today")) {
    return toDateKey(date);
  }

  const isoMatch = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return isoMatch[1];
  }

  return "";
}

function combineDateAndTime(dateKey, timeKey, fallbackMinutes = 60) {
  const now = new Date();

  if (!dateKey && !timeKey) {
    const fallback = new Date(now.getTime() + fallbackMinutes * 60 * 1000);
    return fallback;
  }

  const datePart = dateKey || toDateKey(now);
  const timePart = timeKey || toTimeKey(new Date(now.getTime() + fallbackMinutes * 60 * 1000));
  return new Date(`${datePart}T${timePart}:00`);
}

module.exports = {
  toDateKey,
  toTimeKey,
  parseTimeTo24Hour,
  parseRelativeDate,
  combineDateAndTime,
};
