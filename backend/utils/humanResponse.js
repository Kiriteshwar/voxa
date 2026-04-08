function formatTime(time = "") {
  if (!time) {
    return "";
  }

  const [hourRaw, minute = "00"] = time.split(":");
  let hour = Number(hourRaw);
  const meridiem = hour >= 12 ? "PM" : "AM";
  if (hour === 0) {
    hour = 12;
  } else if (hour > 12) {
    hour -= 12;
  }

  return `${hour}:${minute} ${meridiem}`;
}

function formatTitle(title = "") {
  const trimmed = String(title || "").trim();
  if (!trimmed) {
    return "this item";
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function buildDetails(command) {
  const details = [];
  if (command.date) {
    details.push({ label: "Date", value: command.date });
  }
  if (command.time) {
    details.push({ label: "Time", value: command.time });
  }
  if (command.repeat && command.repeat !== "none") {
    details.push({ label: "Repeat", value: command.repeat });
  }
  return details;
}

function generateHumanResponse(command, matchedItem = null) {
  const action = command.action || "create";
  const entity = matchedItem?.entityType || command.entityType || "item";
  const title = formatTitle(matchedItem?.title || command.target || command.content || "this item");
  const prettyTime = formatTime(command.time);

  if (action === "create" && entity === "reminder") {
    const timeBit = prettyTime ? ` at ${prettyTime}` : "";
    const dateBit = command.date ? ` on ${command.date}` : "";
    return `Got it. I'll remind you to ${title}${dateBit}${timeBit}.`;
  }

  if (action === "create" && entity === "habit") {
    const repeatBit = command.repeat && command.repeat !== "none" ? ` ${command.repeat}` : "";
    const timeBit = prettyTime ? ` at ${prettyTime}` : "";
    return `Got it. I'll add ${title} as a${repeatBit} habit${timeBit}.`;
  }

  if (action === "create" && entity === "note") {
    return `Got it. I'll save a note for "${title}".`;
  }

  if (action === "delete") {
    return `I think you want to delete "${title}".`;
  }

  if (action === "complete") {
    return `I think you want to mark "${title}" as done.`;
  }

  if (action === "snooze") {
    return `I can snooze "${title}" for a bit.`;
  }

  if (action === "stop") {
    return `I think you want to stop "${title}".`;
  }

  if (action === "undo") {
    return "I can undo your last action.";
  }

  return `Here's what I understood for "${title}".`;
}

module.exports = {
  buildDetails,
  formatTime,
  generateHumanResponse,
};
