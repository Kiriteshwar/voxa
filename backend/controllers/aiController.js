const { parseCommand, refineCommandWithGemini } = require("../utils/commandParser");
const { executePreview, previewCommand } = require("../services/commandService");

exports.parseVoiceCommand = async (req, res, next) => {
  try {
    const { text, baseCommand, allowIntentRefine = false } = req.body;

    if (!text) {
      return res.status(400).json({ message: "Text is required" });
    }

    if (baseCommand) {
      let refined = baseCommand;
      let source = "client";

      if (process.env.GEMINI_API_KEY) {
        try {
          refined = await refineCommandWithGemini(text, baseCommand, { allowIntentRefine });
          source = "gemini-refine";
        } catch (_error) {
          refined = baseCommand;
          source = "client-fallback";
        }
      }

      const preview = await previewCommand(
        req.user.id,
        {
          ...baseCommand,
          ...refined,
          confidence: Number(refined.confidence || baseCommand.confidence || 0.6),
        },
        source,
      );

      return res.json(preview);
    }

    const parsed = await parseCommand(text);
    return res.json(await previewCommand(req.user.id, parsed.command, parsed.source));
  } catch (error) {
    return next(error);
  }
};

exports.executeVoiceCommand = async (req, res, next) => {
  try {
    const { text, command, preview } = req.body;

    if (!text && !command && !preview) {
      return res.status(400).json({ message: "Text, command, or preview is required" });
    }

    let parsedPreview = preview;

    if (!parsedPreview) {
      const parsedResult = command ? { source: "client", command } : await parseCommand(text);
      parsedPreview = await previewCommand(req.user.id, parsedResult.command, parsedResult.source);
    }

    const execution = await executePreview(req.user.id, parsedPreview, "voice");

    return res.json({
      source: parsedPreview.source,
      command: parsedPreview.command,
      matchedItem: parsedPreview.matchedItem || null,
      execution,
    });
  } catch (error) {
    return next(error);
  }
};
