const Habit = require("../models/Habit");
const Log = require("../models/Log");
const { toDateKey } = require("../utils/date");

async function attachTodayStatus(userId, habits) {
  const today = toDateKey();
  const logs = await Log.find({
    userId,
    habitId: { $in: habits.map((habit) => habit._id) },
    date: today,
  });

  const statusMap = new Map(logs.map((log) => [String(log.habitId), log.status]));
  return habits.map((habit) => ({
    ...habit.toObject(),
    todayStatus: statusMap.get(String(habit._id)) || "pending",
  }));
}

exports.getHabits = async (req, res, next) => {
  try {
    const habits = await Habit.find({ userId: req.user.id }).sort({ createdAt: -1 });
    return res.json(await attachTodayStatus(req.user.id, habits));
  } catch (error) {
    return next(error);
  }
};

exports.createHabit = async (req, res, next) => {
  try {
    const { name, repeat = "daily", time = "", scheduledDate = "" } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Habit name is required" });
    }

    const habit = await Habit.create({
      userId: req.user.id,
      name,
      repeat,
      time,
      scheduledDate,
    });

    return res.status(201).json(habit);
  } catch (error) {
    return next(error);
  }
};

exports.updateHabit = async (req, res, next) => {
  try {
    const habit = await Habit.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true, runValidators: true }
    );

    if (!habit) {
      return res.status(404).json({ message: "Habit not found" });
    }

    return res.json(habit);
  } catch (error) {
    return next(error);
  }
};

exports.deleteHabit = async (req, res, next) => {
  try {
    const habit = await Habit.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!habit) {
      return res.status(404).json({ message: "Habit not found" });
    }

    await Log.deleteMany({ habitId: req.params.id, userId: req.user.id });

    return res.json({ message: "Habit deleted" });
  } catch (error) {
    return next(error);
  }
};

exports.markHabit = async (req, res, next) => {
  try {
    const { status, date = toDateKey(), source = "manual" } = req.body;

    if (!["completed", "skipped"].includes(status)) {
      return res.status(400).json({ message: "Status must be completed or skipped" });
    }

    const habit = await Habit.findOne({ _id: req.params.id, userId: req.user.id });

    if (!habit) {
      return res.status(404).json({ message: "Habit not found" });
    }

    const log = await Log.findOneAndUpdate(
      {
        habitId: habit._id,
        userId: req.user.id,
        date,
      },
      { status, source },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    habit.status = status;
    await habit.save();

    return res.json({ habit, log });
  } catch (error) {
    return next(error);
  }
};
