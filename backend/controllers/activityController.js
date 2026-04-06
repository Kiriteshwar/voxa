const Habit = require("../models/Habit");
const Log = require("../models/Log");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");
const Schedule = require("../models/Schedule");

function activityItem(id, type, message, createdAt, extra = {}) {
  return {
    id: `${type}:${id}`,
    type,
    message,
    createdAt,
    ...extra,
  };
}

exports.getActivity = async (req, res, next) => {
  try {
    const [habits, notes, reminders, schedules, logs] = await Promise.all([
      Habit.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(10),
      Note.find({ userId: req.user.id }).sort({ updatedAt: -1 }).limit(10),
      Reminder.find({ userId: req.user.id }).sort({ updatedAt: -1 }).limit(10),
      Schedule.find({ userId: req.user.id }).sort({ updatedAt: -1 }).limit(10),
      Log.find({ userId: req.user.id }).populate("habitId", "name").sort({ createdAt: -1 }).limit(10),
    ]);

    const activity = [
      ...habits.map((habit) =>
        activityItem(habit._id, "habit", `Habit created: ${habit.name}`, habit.createdAt)
      ),
      ...notes.map((note) =>
        activityItem(note._id, "note", `Note saved: ${note.title}`, note.updatedAt, {
          category: note.category,
        })
      ),
      ...reminders.map((reminder) =>
        activityItem(
          reminder._id,
          "reminder",
          `Reminder ${reminder.status}: ${reminder.title}`,
          reminder.updatedAt
        )
      ),
      ...schedules.map((schedule) =>
        activityItem(
          schedule._id,
          "schedule",
          `Schedule ${schedule.status}: ${schedule.title}`,
          schedule.updatedAt
        )
      ),
      ...logs.map((log) =>
        activityItem(
          log._id,
          "history",
          `${log.habitId?.name || "Habit"} marked ${log.status}`,
          log.createdAt,
          { status: log.status }
        )
      ),
    ]
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, 12);

    return res.json(activity);
  } catch (error) {
    return next(error);
  }
};

exports.getHistory = async (req, res, next) => {
  try {
    const logs = await Log.find({ userId: req.user.id })
      .populate("habitId", "name")
      .sort({ date: -1, createdAt: -1 })
      .limit(20);

    return res.json(
      logs.map((log) => ({
        id: log._id,
        habitId: log.habitId?._id || null,
        habitName: log.habitId?.name || "Habit",
        date: log.date,
        status: log.status,
        source: log.source,
        note: log.note,
        createdAt: log.createdAt,
      }))
    );
  } catch (error) {
    return next(error);
  }
};
