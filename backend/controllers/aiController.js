const { parseCommand, refineCommandWithGemini, splitCompoundCommands } = require("../utils/commandParser");
const { executePreview, previewCommand, undoLastAction } = require("../services/commandService");

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

      const command = {
        ...baseCommand,
        ...refined,
        confidence: Number(refined.confidence || baseCommand.confidence || 0.6),
      };

      const preview = await previewCommand(req.user.id, command, source);
      return res.json(preview);
    }

    const segments = splitCompoundCommands(text);
    const parsedResults = await Promise.all(segments.map((segment) => parseCommand(segment)));
    const previews = await Promise.all(
      parsedResults.map((parsed) => previewCommand(req.user.id, parsed.command, parsed.source))
    );

    if (previews.length > 1) {
      return res.json({
        multiIntent: true,
        previews,
        confidence: Number(
          (previews.reduce((sum, preview) => sum + (preview.confidence || 0), 0) / previews.length).toFixed(2)
        ),
      });
    }

    return res.json(previews[0]);
  } catch (error) {
    return next(error);
  }
};

exports.executeVoiceCommand = async (req, res, next) => {
  try {
    const { text, command, preview, previews } = req.body;

    if (!text && !command && !preview && !previews) {
      return res.status(400).json({ message: "Text, command, preview, or previews are required" });
    }

    let previewList = previews || (preview ? [preview] : []);

    if (!previewList.length) {
      const parsedSegments = text ? splitCompoundCommands(text) : [""];
      const parsedResults = command
        ? [{ source: "client", command }]
        : await Promise.all(parsedSegments.map((segment) => parseCommand(segment)));
      previewList = await Promise.all(
        parsedResults.map((parsed) => previewCommand(req.user.id, parsed.command, parsed.source))
      );
    }

    const executions = [];
    for (const currentPreview of previewList) {
      executions.push(await executePreview(req.user.id, currentPreview, "voice"));
    }

    return res.json({
      multiIntent: executions.length > 1,
      executions,
      execution: executions[0],
    });
  } catch (error) {
    return next(error);
  }
};

exports.undoVoiceAction = async (req, res, next) => {
  try {
    const result = await undoLastAction(req.user.id);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
