const Habit = require("../models/Habit");
const Log = require("../models/Log");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");
const User = require("../models/User");
const { combineDateAndTime, toDateKey } = require("../utils/date");
const { findBestMatch } = require("../utils/fuzzyMatcher");

const ENTITY_CONFIG = {
  habit: {
    Model: Habit,
    title: (item) => item.name,
    matchText: (item) => item.name,
    sortField: "createdAt",
  },
  note: {
    Model: Note,
    title: (item) => item.title,
    matchText: (item) => `${item.title} ${item.content}`,
    sortField: "updatedAt",
  },
  reminder: {
    Model: Reminder,
    title: (item) => item.title,
    matchText: (item) => `${item.title} ${item.message || ""}`,
    sortField: "updatedAt",
  },
};

function formatActionLabel(action) {
  return {
    create: "Create",
    delete: "Delete",
    complete: "Complete",
    skip: "Skip",
    update: "Update",
    snooze: "Snooze",
    stop: "Stop",
  }[action] || "Review";
}

function formatEntityLabel(entityType) {
  return {
    habit: "Habit",
    note: "Note",
    reminder: "Reminder",
    last: "Last Item",
  }[entityType] || "Item";
}

function serializeMatch(entityType, item, score = 1) {
  if (!item) {
    return null;
  }

  return {
    id: String(item._id),
    entityType,
    title: ENTITY_CONFIG[entityType].title(item),
    score: Number(score.toFixed(2)),
  };
}

async function writeHabitLog({ habitId, userId, status, source }) {
  const date = toDateKey(new Date());

  return Log.findOneAndUpdate(
    { habitId, userId, date },
    { status, source },
    { new: true, upsert: true, runValidators: true }
  );
}

async function getEntityItems(userId, entityType) {
  const config = ENTITY_CONFIG[entityType];
  if (!config) {
    return [];
  }

  const records = await config.Model.find({ userId }).sort({ [config.sortField]: -1 }).limit(25);
  return records.map((record) => ({
    entityType,
    item: record,
    id: String(record._id),
    title: config.title(record),
    matchText: config.matchText(record),
    timestamp: record[config.sortField] || record.createdAt,
  }));
}

async function getLastContextItem(userId) {
  const user = await User.findById(userId).select("voiceContext");
  const context = user?.voiceContext;
  if (!context?.entityType || !context?.itemId || !ENTITY_CONFIG[context.entityType]) {
    return null;
  }

  const config = ENTITY_CONFIG[context.entityType];
  const item = await config.Model.findOne({ _id: context.itemId, userId });
  if (!item) {
    return null;
  }

  return {
    entityType: context.entityType,
    item,
  };
}

async function getLatestItem(userId, preferredEntityType = "") {
  const entityTypes = preferredEntityType && preferredEntityType !== "last"
    ? [preferredEntityType]
    : ["habit", "note", "reminder"];

  const grouped = await Promise.all(entityTypes.map((entityType) => getEntityItems(userId, entityType)));
  const latest = grouped.flat().sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];

  return latest ? { entityType: latest.entityType, item: latest.item } : null;
}

async function setVoiceContext(userId, payload) {
  await User.findByIdAndUpdate(userId, {
    voiceContext: {
      entityType: payload.entityType,
      itemId: payload.itemId,
      title: payload.title,
      updatedAt: new Date(),
    },
  });
}

async function resolveTarget(userId, command) {
  if (command.action === "create") {
    return { matchedItem: null, fuzzyMatched: false, score: 1 };
  }

  if (command.entityType === "last" || !command.target) {
    const contextual = (await getLastContextItem(userId)) || (await getLatestItem(userId, command.entityType));
    if (!contextual) {
      return { matchedItem: null, fuzzyMatched: false, score: 0 };
    }

    return {
      matchedItem: serializeMatch(contextual.entityType, contextual.item, 0.82),
      fuzzyMatched: true,
      score: 0.82,
    };
  }

  const entityTypes = command.entityType && command.entityType !== "last"
    ? [command.entityType]
    : ["habit", "note", "reminder"];

  let best = null;
  for (const entityType of entityTypes) {
    const items = await getEntityItems(userId, entityType);
    const match = findBestMatch(command.target, items, { threshold: 0.45 });
    if (match && (!best || match.score > best.score)) {
      best = {
        matchedItem: serializeMatch(entityType, match.item.item, match.score),
        fuzzyMatched: match.fuzzyMatched,
        score: match.score,
      };
    }
  }

  return best || { matchedItem: null, fuzzyMatched: false, score: 0 };
}

function buildUnderstood(preview) {
  const command = preview.command;
  const targetTitle = preview.matchedItem?.title || command.target || command.content || "Untitled";
  const lines = [`${formatActionLabel(command.action)} ${formatEntityLabel(preview.matchedItem?.entityType || command.entityType)}`];

  if (targetTitle) {
    lines.push(`"${targetTitle}"`);
  }

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

  return {
    headline: lines.join(" "),
    actionLabel: formatActionLabel(command.action),
    entityLabel: formatEntityLabel(preview.matchedItem?.entityType || command.entityType),
    targetLabel: targetTitle,
    details,
    suggestion:
      preview.fuzzyMatched && preview.matchedItem
        ? `Did you mean "${preview.matchedItem.title}"?`
        : "",
  };
}

async function previewCommand(userId, command, source = "rule-engine") {
  const resolution = await resolveTarget(userId, command);
  const confidence = Number(
    Math.max(command.confidence || 0.5, resolution.score ? (command.confidence + resolution.score) / 2 : command.confidence || 0.5).toFixed(2)
  );
  const needsConfirmation =
    command.action === "create"
      ? true
      : !resolution.matchedItem || resolution.fuzzyMatched || confidence < 0.9;

  return {
    source,
    command,
    matchedItem: resolution.matchedItem,
    fuzzyMatched: resolution.fuzzyMatched,
    confidence,
    needsConfirmation,
    understood: buildUnderstood({ command, matchedItem: resolution.matchedItem, fuzzyMatched: resolution.fuzzyMatched }),
  };
}

async function loadMatchedDocument(userId, matchedItem) {
  if (!matchedItem || !ENTITY_CONFIG[matchedItem.entityType]) {
    return null;
  }

  return ENTITY_CONFIG[matchedItem.entityType].Model.findOne({ _id: matchedItem.id, userId });
}

async function executePreview(userId, preview, source = "voice") {
  const { command } = preview;
  const targetEntityType = preview.matchedItem?.entityType || command.entityType;
  const matchedDocument = await loadMatchedDocument(userId, preview.matchedItem);

  if (command.action !== "create" && !matchedDocument) {
    throw new Error("Please confirm a specific item before executing this command.");
  }

  if (targetEntityType === "habit") {
    if (command.action === "create") {
      const habit = await Habit.create({
        userId,
        name: command.target || command.content,
        repeat: command.repeat === "none" ? "daily" : command.repeat,
        time: command.time || "",
        scheduledDate: command.date || "",
      });
      await setVoiceContext(userId, { entityType: "habit", itemId: habit._id, title: habit.name });
      return { message: `Habit created: ${habit.name}`, data: habit };
    }

    if (command.action === "complete" || command.action === "skip") {
      const status = command.action === "complete" ? "completed" : "skipped";
      matchedDocument.status = status;
      await matchedDocument.save();
      const log = await writeHabitLog({ habitId: matchedDocument._id, userId, status, source });
      await setVoiceContext(userId, { entityType: "habit", itemId: matchedDocument._id, title: matchedDocument.name });
      return { message: `Habit ${status}: ${matchedDocument.name}`, data: { habit: matchedDocument, log } };
    }

    if (command.action === "delete") {
      await Log.deleteMany({ habitId: matchedDocument._id, userId });
      await matchedDocument.deleteOne();
      await setVoiceContext(userId, { entityType: "habit", itemId: matchedDocument._id, title: matchedDocument.name });
      return { message: `Habit deleted: ${matchedDocument.name}` };
    }
  }

  if (targetEntityType === "note") {
    if (command.action === "create") {
      const body = command.content || command.target || "Quick note";
      const note = await Note.create({
        userId,
        title: body.slice(0, 60),
        content: body,
        category: "general",
      });
      await setVoiceContext(userId, { entityType: "note", itemId: note._id, title: note.title });
      return { message: `Note created: ${note.title}`, data: note };
    }

    if (command.action === "delete") {
      await matchedDocument.deleteOne();
      await setVoiceContext(userId, { entityType: "note", itemId: matchedDocument._id, title: matchedDocument.title });
      return { message: `Note deleted: ${matchedDocument.title}` };
    }
  }

  if (targetEntityType === "reminder") {
    if (command.action === "create") {
      const reminder = await Reminder.create({
        userId,
        title: (command.target || command.content || "Reminder").slice(0, 60),
        message: command.content || command.target || "Reminder",
        scheduledFor: combineDateAndTime(command.date, command.time),
        status: "active",
      });
      await setVoiceContext(userId, { entityType: "reminder", itemId: reminder._id, title: reminder.title });
      return { message: `Reminder created: ${reminder.title}`, data: reminder };
    }

    if (command.action === "delete" || command.action === "stop") {
      if (command.action === "stop") {
        matchedDocument.status = "dismissed";
        await matchedDocument.save();
      } else {
        await matchedDocument.deleteOne();
      }
      await setVoiceContext(userId, { entityType: "reminder", itemId: matchedDocument._id, title: matchedDocument.title });
      return { message: `Reminder ${command.action === "stop" ? "stopped" : "deleted"}: ${matchedDocument.title}`, data: matchedDocument };
    }

    if (command.action === "snooze") {
      matchedDocument.status = "snoozed";
      matchedDocument.scheduledFor = combineDateAndTime(command.date, command.time, 10);
      await matchedDocument.save();
      await setVoiceContext(userId, { entityType: "reminder", itemId: matchedDocument._id, title: matchedDocument.title });
      return { message: `Reminder snoozed: ${matchedDocument.title}`, data: matchedDocument };
    }
  }

  throw new Error("Unsupported voice action");
}

module.exports = {
  executePreview,
  previewCommand,
  setVoiceContext,
};
