const Habit = require("../models/Habit");
const Log = require("../models/Log");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");
const { combineDateAndTime, toDateKey } = require("../utils/date");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findByName(Model, userId, field, target) {
  const query = target
    ? { userId, [field]: { $regex: new RegExp(escapeRegex(target), "i") } }
    : { userId };
  return Model.findOne(query).sort({ createdAt: -1 });
}

async function writeHabitLog({ habitId, userId, status, source }) {
  const date = toDateKey(new Date());

  return Log.findOneAndUpdate(
    { habitId, userId, date },
    { status, source },
    { new: true, upsert: true, runValidators: true }
  );
}

async function executeCommand(userId, command, source = "voice") {
  const { action, entityType, target, content, date, time, repeat } = command;

  if (entityType === "habit") {
    if (action === "create") {
      const habit = await Habit.create({
        userId,
        name: target || content,
        repeat: repeat === "none" ? "daily" : repeat,
        time: time || "",
        scheduledDate: date || "",
      });

      return { message: `Habit "${habit.name}" created`, data: habit };
    }

    if (action === "complete" || action === "skip") {
      const habit = await findByName(Habit, userId, "name", target);
      if (!habit) {
        throw new Error(`Habit "${target}" not found`);
      }

      const status = action === "complete" ? "completed" : "skipped";
      habit.status = status;
      await habit.save();
      const log = await writeHabitLog({ habitId: habit._id, userId, status, source });

      return { message: `Habit "${habit.name}" marked ${status}`, data: { habit, log } };
    }

    if (action === "delete") {
      const habit = await findByName(Habit, userId, "name", target);
      if (!habit) {
        throw new Error(`Habit "${target}" not found`);
      }

      await Log.deleteMany({ habitId: habit._id, userId });
      await habit.deleteOne();
      return { message: `Habit "${habit.name}" deleted` };
    }
  }

  if (entityType === "note") {
    if (action === "create") {
      const body = content || target;
      const note = await Note.create({
        userId,
        title: body.slice(0, 40) || "Quick note",
        content: body,
      });

      return { message: "Note created", data: note };
    }

    if (action === "delete") {
      const note = await findByName(Note, userId, "content", target);
      if (!note) {
        throw new Error(`Note "${target}" not found`);
      }

      await note.deleteOne();
      return { message: "Note deleted" };
    }
  }

  if (entityType === "reminder") {
    if (action === "create") {
      const scheduledFor = combineDateAndTime(date, time);
      const reminder = await Reminder.create({
        userId,
        title: (target || content || "Reminder").slice(0, 60),
        message: content || target || "Reminder",
        scheduledFor,
        status: "active",
      });

      return { message: "Reminder created", data: reminder };
    }

    const reminder = await findByName(Reminder, userId, "title", target);
    if (!reminder) {
      throw new Error(`Reminder "${target}" not found`);
    }

    if (action === "delete") {
      await reminder.deleteOne();
      return { message: "Reminder deleted" };
    }

    if (action === "stop") {
      reminder.status = "dismissed";
      await reminder.save();
      return { message: "Reminder stopped", data: reminder };
    }

    if (action === "snooze") {
      reminder.status = "snoozed";
      reminder.scheduledFor = combineDateAndTime("", time, 10);
      await reminder.save();
      return { message: "Reminder snoozed", data: reminder };
    }
  }

  throw new Error("Unsupported command");
}

module.exports = {
  executeCommand,
};
