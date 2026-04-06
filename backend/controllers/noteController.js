const Note = require("../models/Note");

exports.getNotes = async (req, res, next) => {
  try {
    const notes = await Note.find({ userId: req.user.id }).sort({ updatedAt: -1 });
    return res.json(notes);
  } catch (error) {
    return next(error);
  }
};

exports.createNote = async (req, res, next) => {
  try {
    const { title, content, category = "general" } = req.body;

    if (!content) {
      return res.status(400).json({ message: "Note content is required" });
    }

    const note = await Note.create({
      userId: req.user.id,
      title: title || content.slice(0, 40),
      content,
      category,
    });

    return res.status(201).json(note);
  } catch (error) {
    return next(error);
  }
};

exports.updateNote = async (req, res, next) => {
  try {
    const updates = { ...req.body };
    if (!updates.title && updates.content) {
      updates.title = updates.content.slice(0, 40);
    }

    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      updates,
      { new: true, runValidators: true }
    );

    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    return res.json(note);
  } catch (error) {
    return next(error);
  }
};

exports.deleteNote = async (req, res, next) => {
  try {
    const note = await Note.findOneAndDelete({ _id: req.params.id, userId: req.user.id });

    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    return res.json({ message: "Note deleted" });
  } catch (error) {
    return next(error);
  }
};
