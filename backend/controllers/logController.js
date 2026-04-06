const Habit = require("../models/Habit");
const Log = require("../models/Log");
const Note = require("../models/Note");
const Reminder = require("../models/Reminder");
const Schedule = require("../models/Schedule");

function getDateRange(days) {
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

function calculateStreak(logDates) {
  const completedDays = new Set(logDates);
  let streak = 0;
  const current = new Date();

  while (true) {
    const isoDate = current.toISOString().slice(0, 10);
    if (!completedDays.has(isoDate)) {
      break;
    }
    streak += 1;
    current.setDate(current.getDate() - 1);
  }

  return streak;
}

exports.getLogs = async (req, res, next) => {
  try {
    const logs = await Log.find({ userId: req.user.id }).sort({ date: -1 });
    return res.json(logs);
  } catch (error) {
    return next(error);
  }
};

exports.getAnalytics = async (req, res, next) => {
  try {
    const habits = await Habit.find({ userId: req.user.id });
    const logs = await Log.find({ userId: req.user.id }).sort({ date: 1 });
    const completedLogs = logs.filter((log) => log.status === "completed");
    const skippedLogs = logs.filter((log) => log.status === "skipped");
    const weeklyCutoff = getDateRange(7);
    const monthlyCutoff = getDateRange(30);

    const habitAnalytics = habits.map((habit) => {
      const habitLogs = logs.filter((log) => String(log.habitId) === String(habit._id));
      const habitCompletedDates = habitLogs
        .filter((log) => log.status === "completed")
        .map((log) => log.date);
      const completedCount = habitLogs.filter((log) => log.status === "completed").length;
      const totalCount = habitLogs.length;

      return {
        habitId: habit._id,
        name: habit.name,
        streak: calculateStreak(habitCompletedDates),
        completionRate: totalCount ? Number(((completedCount / totalCount) * 100).toFixed(1)) : 0,
        completedCount,
        skippedCount: habitLogs.filter((log) => log.status === "skipped").length,
      };
    });

    const weeklyLogs = logs.filter((log) => log.date >= weeklyCutoff);
    const monthlyLogs = logs.filter((log) => log.date >= monthlyCutoff);

    return res.json({
      overview: {
        totalHabits: habits.length,
        totalNotes: await Note.countDocuments({ userId: req.user.id }),
        totalReminders: await Reminder.countDocuments({ userId: req.user.id }),
        totalSchedules: await Schedule.countDocuments({ userId: req.user.id }),
        completedDays: completedLogs.length,
        skippedDays: skippedLogs.length,
        overallCompletionRate: logs.length
          ? Number(((completedLogs.length / logs.length) * 100).toFixed(1))
          : 0,
      },
      weekly: {
        completed: weeklyLogs.filter((log) => log.status === "completed").length,
        skipped: weeklyLogs.filter((log) => log.status === "skipped").length,
      },
      monthly: {
        completed: monthlyLogs.filter((log) => log.status === "completed").length,
        skipped: monthlyLogs.filter((log) => log.status === "skipped").length,
      },
      missedHabits: habitAnalytics.filter(
        (habit) => !habit.completedCount || habit.completionRate < 50
      ),
      habits: habitAnalytics,
    });
  } catch (error) {
    return next(error);
  }
};
