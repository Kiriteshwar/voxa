const { parseCommand, refineCommandWithGemini } = require("../utils/commandParser");
const { executeCommand } = require("../services/commandService");

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

      return res.json({
        source,
        command: {
          ...baseCommand,
          ...refined,
          confidence: Number(refined.confidence || baseCommand.confidence || 0.6),
        },
      });
    }

    return res.json(await parseCommand(text));
  } catch (error) {
    return next(error);
  }
};

exports.executeVoiceCommand = async (req, res, next) => {
  try {
    const { text, command } = req.body;

    if (!text && !command) {
      return res.status(400).json({ message: "Text or parsed command is required" });
    }

    const parsedResult = command ? { source: "client", command } : await parseCommand(text);
    const execution = await executeCommand(req.user.id, parsedResult.command, "voice");

    return res.json({
      source: parsedResult.source,
      command: parsedResult.command,
      execution,
    });
  } catch (error) {
    return next(error);
  }
};
