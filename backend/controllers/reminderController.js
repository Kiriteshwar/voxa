const Reminder = require("../models/Reminder");
const { combineDateAndTime } = require("../utils/date");

exports.getReminders = async (req, res, next) => {
  try {
    const reminders = await Reminder.find({ userId: req.user.id }).sort({ scheduledFor: 1 });
    return res.json(reminders);
  } catch (error) {
    return next(error);
  }
};

exports.createReminder = async (req, res, next) => {
  try {
    const { title, message = "", date = "", time = "" } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Reminder title is required" });
    }

    const reminder = await Reminder.create({
      userId: req.user.id,
      title,
      message,
      scheduledFor: combineDateAndTime(date, time),
      status: "active",
    });

    return res.status(201).json(reminder);
  } catch (error) {
    return next(error);
  }
};

exports.updateReminder = async (req, res, next) => {
  try {
    const updates = { ...req.body };
    if (req.body.date || req.body.time) {
      updates.scheduledFor = combineDateAndTime(req.body.date, req.body.time);
    }

    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      updates,
      { new: true, runValidators: true }
    );

    if (!reminder) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    return res.json(reminder);
  } catch (error) {
    return next(error);
  }
};

exports.deleteReminder = async (req, res, next) => {
  try {
    const reminder = await Reminder.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!reminder) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    return res.json({ message: "Reminder deleted" });
  } catch (error) {
    return next(error);
  }
};

exports.snoozeReminder = async (req, res, next) => {
  try {
    const minutes = Number(req.body.minutes || 10);
    const reminder = await Reminder.findOne({ _id: req.params.id, userId: req.user.id });

    if (!reminder) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    reminder.status = "snoozed";
    reminder.scheduledFor = new Date(Date.now() + minutes * 60 * 1000);
    await reminder.save();

    return res.json(reminder);
  } catch (error) {
    return next(error);
  }
};

exports.stopReminder = async (req, res, next) => {
  try {
    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { status: "dismissed" },
      { new: true }
    );

    if (!reminder) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    return res.json(reminder);
  } catch (error) {
    return next(error);
  }
};
