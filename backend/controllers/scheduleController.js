const Schedule = require("../models/Schedule");
const { combineDateAndTime } = require("../utils/date");

function serializeSchedule(schedule) {
  return {
    ...schedule.toObject(),
    date: schedule.scheduledFor.toISOString().slice(0, 10),
    time: schedule.scheduledFor.toISOString().slice(11, 16),
  };
}

exports.getSchedules = async (req, res, next) => {
  try {
    const schedules = await Schedule.find({ userId: req.user.id }).sort({ scheduledFor: 1 });
    return res.json(schedules.map(serializeSchedule));
  } catch (error) {
    return next(error);
  }
};

exports.createSchedule = async (req, res, next) => {
  try {
    const { title, category = "general", date = "", time = "" } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Schedule title is required" });
    }

    const schedule = await Schedule.create({
      userId: req.user.id,
      title,
      category,
      scheduledFor: combineDateAndTime(date, time),
      status: "scheduled",
    });

    return res.status(201).json(serializeSchedule(schedule));
  } catch (error) {
    return next(error);
  }
};

exports.updateSchedule = async (req, res, next) => {
  try {
    const updates = { ...req.body };
    if (req.body.date || req.body.time) {
      updates.scheduledFor = combineDateAndTime(req.body.date, req.body.time);
    }

    const schedule = await Schedule.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      updates,
      { new: true, runValidators: true }
    );

    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    return res.json(serializeSchedule(schedule));
  } catch (error) {
    return next(error);
  }
};

exports.deleteSchedule = async (req, res, next) => {
  try {
    const schedule = await Schedule.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    return res.json({ message: "Schedule deleted" });
  } catch (error) {
    return next(error);
  }
};
