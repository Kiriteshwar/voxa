const Habit = require("../models/Habit");
const Log = require("../models/Log");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");
const User = require("../models/User");
const { combineDateAndTime, toDateKey } = require("../utils/date");
const { findBestMatch } = require("../utils/fuzzyMatcher");
const { buildDetails, generateHumanResponse } = require("../utils/humanResponse");

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
    undo: "Undo",
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
  if (!item || !ENTITY_CONFIG[entityType]) {
    return null;
  }

  return {
    id: String(item._id),
    entityType,
    title: ENTITY_CONFIG[entityType].title(item),
    score: Number(score.toFixed(2)),
  };
}

function serializeSnapshot(entityType, item) {
  if (!item) {
    return null;
  }

  return {
    entityType,
    data: typeof item.toObject === "function" ? item.toObject() : item,
  };
}

function getNextHourDefaults() {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return {
    date: toDateKey(next),
    time: `${String(next.getHours()).padStart(2, "0")}:00`,
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

async function updateUserMemory(userId, updates = {}) {
  const currentUser = await User.findById(userId).select("assistantMemory voiceContext");
  const assistantMemory = {
    ...(currentUser?.assistantMemory?.toObject?.() || currentUser?.assistantMemory || {}),
    ...updates.assistantMemory,
  };
  const voiceContext = updates.voiceContext || currentUser?.voiceContext || {};

  await User.findByIdAndUpdate(userId, {
    assistantMemory,
    voiceContext,
  });
}

async function setVoiceContext(userId, payload) {
  const reference = {
    entityType: payload.entityType,
    itemId: payload.itemId,
    title: payload.title,
    updatedAt: new Date(),
  };

  await updateUserMemory(userId, {
    voiceContext: reference,
    assistantMemory: {
      lastViewed: reference,
    },
  });
}

async function rememberMutation(userId, mutation) {
  const now = new Date();
  const assistantMemory = {
    lastUndo: {
      actionType: mutation.actionType,
      entityType: mutation.entityType,
      itemId: mutation.itemId || null,
      snapshot: mutation.snapshot || null,
      updatedAt: now,
    },
  };

  if (mutation.actionType === "create") {
    assistantMemory.lastCreated = {
      entityType: mutation.entityType,
      itemId: mutation.itemId || null,
      title: mutation.title || "",
      updatedAt: now,
    };
  }

  if (mutation.actionType === "delete") {
    assistantMemory.lastDeleted = {
      entityType: mutation.entityType,
      itemId: mutation.itemId || null,
      title: mutation.title || "",
      snapshot: mutation.snapshot || null,
      updatedAt: now,
    };
  }

  if (mutation.actionType === "complete") {
    assistantMemory.lastCompleted = {
      entityType: mutation.entityType,
      itemId: mutation.itemId || null,
      title: mutation.title || "",
      updatedAt: now,
    };
  }

  await updateUserMemory(userId, { assistantMemory });
}

async function getEntityItems(userId, entityType) {
  const config = ENTITY_CONFIG[entityType];
  if (!config) {
    return [];
  }

  const records = await config.Model.find({ userId }).sort({ [config.sortField]: -1 }).limit(25);
  return records.map((record, index) => ({
    entityType,
    item: record,
    id: String(record._id),
    title: config.title(record),
    matchText: config.matchText(record),
    timestamp: record[config.sortField] || record.createdAt,
    frequencyBoost: index < 3 ? 0.03 : 0,
  }));
}

async function getMemoryReference(userId, key) {
  const user = await User.findById(userId).select("assistantMemory");
  const memory = user?.assistantMemory?.[key];
  if (!memory?.entityType || !memory?.itemId) {
    return null;
  }

  const config = ENTITY_CONFIG[memory.entityType];
  if (!config) {
    return null;
  }

  const item = await config.Model.findOne({ _id: memory.itemId, userId });
  if (!item) {
    return null;
  }

  return {
    entityType: memory.entityType,
    item,
  };
}

async function getLastContextItem(userId, action = "") {
  const user = await User.findById(userId).select("voiceContext assistantMemory");
  const voiceContext = user?.voiceContext;

  const preferredMemoryKey =
    action === "complete"
      ? "lastCompleted"
      : action === "delete"
        ? "lastDeleted"
        : "lastViewed";

  const candidates = [voiceContext, user?.assistantMemory?.[preferredMemoryKey], user?.assistantMemory?.lastCreated];

  for (const reference of candidates) {
    if (!reference?.entityType || !reference?.itemId || !ENTITY_CONFIG[reference.entityType]) {
      continue;
    }

    const item = await ENTITY_CONFIG[reference.entityType].Model.findOne({
      _id: reference.itemId,
      userId,
    });

    if (item) {
      return {
        entityType: reference.entityType,
        item,
      };
    }
  }

  return null;
}

async function getLatestItem(userId, preferredEntityType = "") {
  const entityTypes =
    preferredEntityType && preferredEntityType !== "last"
      ? [preferredEntityType]
      : ["habit", "note", "reminder"];

  const grouped = await Promise.all(entityTypes.map((entityType) => getEntityItems(userId, entityType)));
  const latest = grouped
    .flat()
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];

  return latest ? { entityType: latest.entityType, item: latest.item } : null;
}

function applySmartDefaults(command) {
  const nextCommand = { ...command };
  const missingFields = [];
  let suggestion = "";

  if (nextCommand.action === "create" && nextCommand.entityType === "reminder") {
    const defaults = getNextHourDefaults();
    if (!nextCommand.date) {
      nextCommand.date = defaults.date;
    }
    if (!nextCommand.time) {
      nextCommand.time = defaults.time;
      missingFields.push("time");
      suggestion = "What time should I set? I can use the next hour by default.";
    }
  }

  if (nextCommand.action === "create" && !nextCommand.target && !nextCommand.content) {
    missingFields.push("title");
    suggestion = suggestion || "What should I call this?";
  }

  return { command: nextCommand, missingFields, suggestion };
}

async function resolveTarget(userId, command) {
  if (command.action === "create") {
    return { matchedItem: null, fuzzyMatched: false, score: 1 };
  }

  if (command.entityType === "last" || !command.target) {
    const contextual = (await getLastContextItem(userId, command.action)) || (await getLatestItem(userId, command.entityType));
    if (!contextual) {
      return { matchedItem: null, fuzzyMatched: false, score: 0 };
    }

    return {
      matchedItem: serializeMatch(contextual.entityType, contextual.item, 0.82),
      fuzzyMatched: true,
      score: 0.82,
    };
  }

  const entityTypes =
    command.entityType && command.entityType !== "last"
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

  return {
    headline: generateHumanResponse(command, preview.matchedItem),
    actionLabel: formatActionLabel(command.action),
    entityLabel: formatEntityLabel(preview.matchedItem?.entityType || command.entityType),
    targetLabel: targetTitle,
    details: buildDetails(command),
    suggestion:
      preview.suggestion ||
      (preview.fuzzyMatched && preview.matchedItem
        ? `Did you mean "${preview.matchedItem.title}"?`
        : ""),
  };
}

async function previewCommand(userId, command, source = "rule-engine") {
  if (command.action === "undo") {
    const preview = {
      source,
      command,
      matchedItem: null,
      fuzzyMatched: false,
      confidence: 0.96,
      missingFields: [],
      suggestion: "I can undo your last action if you confirm.",
      needsConfirmation: true,
    };

    return {
      ...preview,
      understood: buildUnderstood(preview),
    };
  }

  const smart = applySmartDefaults(command);
  const resolution = await resolveTarget(userId, smart.command);
  let confidence = Number(
    Math.max(
      smart.command.confidence || 0.5,
      resolution.score ? (smart.command.confidence + resolution.score) / 2 : smart.command.confidence || 0.5
    ).toFixed(2)
  );

  if (smart.missingFields.length) {
    confidence = Math.max(0.45, Number((confidence - 0.12).toFixed(2)));
  }

  const needsConfirmation =
    smart.command.action === "create" ||
    !resolution.matchedItem ||
    resolution.fuzzyMatched ||
    confidence < 0.9 ||
    smart.missingFields.length > 0;

  const preview = {
    source,
    command: smart.command,
    matchedItem: resolution.matchedItem,
    fuzzyMatched: resolution.fuzzyMatched,
    confidence,
    missingFields: smart.missingFields,
    suggestion: smart.suggestion,
    needsConfirmation,
  };

  return {
    ...preview,
    understood: buildUnderstood(preview),
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

  if (command.action === "undo") {
    return undoLastAction(userId);
  }

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
      await rememberMutation(userId, {
        actionType: "create",
        entityType: "habit",
        itemId: habit._id,
        title: habit.name,
        snapshot: serializeSnapshot("habit", habit),
      });
      return { message: `Got it. I created "${habit.name}".`, data: habit, undoAvailable: true };
    }

    if (command.action === "complete" || command.action === "skip") {
      const status = command.action === "complete" ? "completed" : "skipped";
      const previousSnapshot = serializeSnapshot("habit", matchedDocument);
      matchedDocument.status = status;
      await matchedDocument.save();
      const log = await writeHabitLog({ habitId: matchedDocument._id, userId, status, source });
      await setVoiceContext(userId, {
        entityType: "habit",
        itemId: matchedDocument._id,
        title: matchedDocument.name,
      });
      await rememberMutation(userId, {
        actionType: "complete",
        entityType: "habit",
        itemId: matchedDocument._id,
        title: matchedDocument.name,
        snapshot: {
          previous: previousSnapshot,
          logId: String(log._id),
        },
      });
      return {
        message: `Done. I marked "${matchedDocument.name}" as ${status}.`,
        data: { habit: matchedDocument, log },
        undoAvailable: true,
      };
    }

    if (command.action === "delete") {
      const snapshot = serializeSnapshot("habit", matchedDocument);
      await Log.deleteMany({ habitId: matchedDocument._id, userId });
      await matchedDocument.deleteOne();
      await setVoiceContext(userId, {
        entityType: "habit",
        itemId: snapshot.data._id,
        title: snapshot.data.name,
      });
      await rememberMutation(userId, {
        actionType: "delete",
        entityType: "habit",
        itemId: snapshot.data._id,
        title: snapshot.data.name,
        snapshot,
      });
      return { message: `Done. I deleted "${snapshot.data.name}".`, undoAvailable: true };
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
      await rememberMutation(userId, {
        actionType: "create",
        entityType: "note",
        itemId: note._id,
        title: note.title,
        snapshot: serializeSnapshot("note", note),
      });
      return { message: `Got it. I saved the note "${note.title}".`, data: note, undoAvailable: true };
    }

    if (command.action === "delete") {
      const snapshot = serializeSnapshot("note", matchedDocument);
      await matchedDocument.deleteOne();
      await setVoiceContext(userId, {
        entityType: "note",
        itemId: snapshot.data._id,
        title: snapshot.data.title,
      });
      await rememberMutation(userId, {
        actionType: "delete",
        entityType: "note",
        itemId: snapshot.data._id,
        title: snapshot.data.title,
        snapshot,
      });
      return { message: `Done. I deleted the note "${snapshot.data.title}".`, undoAvailable: true };
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
      await setVoiceContext(userId, {
        entityType: "reminder",
        itemId: reminder._id,
        title: reminder.title,
      });
      await rememberMutation(userId, {
        actionType: "create",
        entityType: "reminder",
        itemId: reminder._id,
        title: reminder.title,
        snapshot: serializeSnapshot("reminder", reminder),
      });
      return {
        message: `Got it. I'll remind you about "${reminder.title}".`,
        data: reminder,
        undoAvailable: true,
      };
    }

    if (command.action === "delete" || command.action === "stop") {
      const snapshot = serializeSnapshot("reminder", matchedDocument);
      if (command.action === "stop") {
        matchedDocument.status = "dismissed";
        await matchedDocument.save();
      } else {
        await matchedDocument.deleteOne();
      }
      await setVoiceContext(userId, {
        entityType: "reminder",
        itemId: snapshot.data._id,
        title: snapshot.data.title,
      });
      await rememberMutation(userId, {
        actionType: command.action === "stop" ? "complete" : "delete",
        entityType: "reminder",
        itemId: snapshot.data._id,
        title: snapshot.data.title,
        snapshot,
      });
      return {
        message: `Done. I ${command.action === "stop" ? "stopped" : "deleted"} "${snapshot.data.title}".`,
        undoAvailable: true,
      };
    }

    if (command.action === "snooze") {
      const snapshot = serializeSnapshot("reminder", matchedDocument);
      matchedDocument.status = "snoozed";
      matchedDocument.scheduledFor = combineDateAndTime(command.date, command.time, 10);
      await matchedDocument.save();
      await setVoiceContext(userId, {
        entityType: "reminder",
        itemId: matchedDocument._id,
        title: matchedDocument.title,
      });
      await rememberMutation(userId, {
        actionType: "update",
        entityType: "reminder",
        itemId: matchedDocument._id,
        title: matchedDocument.title,
        snapshot,
      });
      return { message: `Done. I snoozed "${matchedDocument.title}".`, data: matchedDocument, undoAvailable: true };
    }
  }

  throw new Error("Unsupported voice action");
}

async function undoLastAction(userId) {
  const user = await User.findById(userId).select("assistantMemory");
  const lastUndo = user?.assistantMemory?.lastUndo;

  if (!lastUndo?.actionType || !lastUndo?.entityType) {
    throw new Error("There is nothing to undo right now.");
  }

  if (lastUndo.actionType === "create" && lastUndo.itemId && ENTITY_CONFIG[lastUndo.entityType]) {
    await ENTITY_CONFIG[lastUndo.entityType].Model.findOneAndDelete({
      _id: lastUndo.itemId,
      userId,
    });
  }

  if (lastUndo.actionType === "delete" && lastUndo.snapshot?.data && ENTITY_CONFIG[lastUndo.entityType]) {
    const Model = ENTITY_CONFIG[lastUndo.entityType].Model;
    const restored = { ...lastUndo.snapshot.data };
    delete restored._id;
    await Model.create({
      ...restored,
      userId,
    });
  }

  if (lastUndo.actionType === "complete" && lastUndo.entityType === "habit" && lastUndo.snapshot?.previous?.data) {
    const restored = lastUndo.snapshot.previous.data;
    await Habit.findOneAndUpdate(
      { _id: restored._id, userId },
      { status: restored.status || "pending" }
    );
    await Log.findByIdAndDelete(lastUndo.snapshot.logId);
  }

  await updateUserMemory(userId, {
    assistantMemory: {
      lastUndo: {
        actionType: "",
        entityType: "",
        itemId: null,
        snapshot: null,
        updatedAt: new Date(),
      },
    },
  });

  return { message: "Last action undone." };
}

module.exports = {
  executePreview,
  previewCommand,
  setVoiceContext,
  undoLastAction,
};
