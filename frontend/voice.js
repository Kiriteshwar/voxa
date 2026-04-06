(function voiceModule() {
  const page = document.body.dataset.page;
  if (page !== "voice") {
    return;
  }

  const recognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!window.voxaApi.isAuthenticated()) {
    window.location.replace("/pages/login.html");
    return;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
  }

  document.getElementById("voiceUserEmail").textContent = window.voxaApi.getCurrentUser()?.email || "";

  const startButton = document.getElementById("startVoiceButton");
  const stopButton = document.getElementById("stopVoiceButton");
  const liveText = document.getElementById("liveText");
  const voiceState = document.getElementById("voiceState");
  const voiceFeedback = document.getElementById("voiceFeedback");
  const voiceResult = document.getElementById("voiceResult");
  const spokenResult = document.getElementById("spokenResult");
  const parsedSummary = document.getElementById("parsedSummary");
  const parsedConfidence = document.getElementById("parsedConfidence");
  const matchedSuggestion = document.getElementById("matchedSuggestion");
  const confirmButton = document.getElementById("confirmVoiceButton");
  const editButton = document.getElementById("editVoiceButton");
  const cancelButton = document.getElementById("cancelVoiceButton");
  const micOrb = document.getElementById("micOrb");

  let recognition = null;
  let activeSessionId = 0;
  let shouldAutoRestart = false;
  let manualStop = false;
  let recognitionRunning = false;
  let isListening = false;
  let isParsing = false;
  let finalTranscript = "";
  let interimTranscript = "";
  let parsedPreview = null;

  function sanitizeTranscript(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function resetResult() {
    voiceResult.classList.add("hidden");
    spokenResult.textContent = "";
    parsedSummary.textContent = "";
    parsedConfidence.textContent = "";
    matchedSuggestion.textContent = "";
    parsedPreview = null;
  }

  function setVoiceTone(tone) {
    voiceState.className = `state-pill state-pill--${tone}`;
    voiceFeedback.className = `support-text centered-text voice-feedback voice-feedback--${tone}`;
  }

  function setInteractionState(state) {
    const map = {
      idle: {
        label: "Idle",
        tone: "idle",
        startLabel: "Start Voice",
        startDisabled: false,
        stopHidden: true,
        listening: false,
      },
      listening: {
        label: "Listening",
        tone: "listening",
        startLabel: "Listening...",
        startDisabled: true,
        stopHidden: false,
        listening: true,
      },
      processing: {
        label: "Understanding",
        tone: "processing",
        startLabel: "Understanding...",
        startDisabled: true,
        stopHidden: true,
        listening: false,
      },
      ready: {
        label: "Ready",
        tone: "ready",
        startLabel: "Start Voice",
        startDisabled: false,
        stopHidden: true,
        listening: false,
      },
      error: {
        label: "Needs Retry",
        tone: "error",
        startLabel: "Start Voice",
        startDisabled: false,
        stopHidden: true,
        listening: false,
      },
    };

    const next = map[state] || map.idle;
    isListening = next.listening;
    voiceState.textContent = next.label;
    setVoiceTone(next.tone);
    micOrb.classList.toggle("is-listening", next.listening);
    stopButton.classList.toggle("hidden", next.stopHidden);
    startButton.textContent = next.startLabel;
    startButton.disabled = next.startDisabled || isParsing;
    confirmButton.disabled = isParsing;
    editButton.disabled = isParsing;
    cancelButton.disabled = isParsing;
  }

  function ensureRecognition() {
    if (!recognitionApi || recognition) {
      return recognition;
    }

    recognition = new recognitionApi();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onstart = () => {
      recognitionRunning = true;
      console.debug("[Voice] recognition started", { sessionId: activeSessionId });
    };

    recognition.onresult = (event) => {
      const finalParts = [];
      const interimParts = [];

      for (let index = 0; index < event.results.length; index += 1) {
        const text = sanitizeTranscript(event.results[index][0].transcript);
        if (!text) {
          continue;
        }

        if (event.results[index].isFinal) {
          finalParts.push(text);
        } else {
          interimParts.push(text);
        }
      }

      finalTranscript = sanitizeTranscript(finalParts.join(" "));
      interimTranscript = sanitizeTranscript(interimParts.join(" "));
      liveText.textContent = sanitizeTranscript([finalTranscript, interimTranscript].join(" ")) || "Listening...";

      console.debug("[Voice] transcript", {
        sessionId: activeSessionId,
        finalTranscript,
        interimTranscript,
      });
    };

    recognition.onerror = (event) => {
      const errorMessages = {
        "audio-capture": "No microphone was found. Please check your mic.",
        "not-allowed": "Microphone access was denied. Please allow mic permission and try again.",
        "no-speech": "I did not hear anything yet. Keep speaking or try again.",
        aborted: "Voice capture was interrupted. Try again.",
      };

      recognitionRunning = false;
      shouldAutoRestart = false;
      manualStop = false;
      voiceFeedback.textContent = errorMessages[event.error] || `Voice error: ${event.error}`;
      setInteractionState("error");
    };

    recognition.onend = () => {
      recognitionRunning = false;
      console.debug("[Voice] recognition ended", {
        sessionId: activeSessionId,
        manualStop,
        shouldAutoRestart,
      });

      if (manualStop) {
        manualStop = false;
        handleStop();
        return;
      }

      if (shouldAutoRestart) {
        window.setTimeout(() => {
          if (!recognitionRunning && shouldAutoRestart) {
            try {
              recognition.start();
            } catch (_error) {
              voiceFeedback.textContent = "Listening paused. Tap Start Voice to continue.";
              setInteractionState("error");
            }
          }
        }, 120);
      }
    };

    return recognition;
  }

  function startVoice() {
    const instance = ensureRecognition();
    if (!instance) {
      voiceFeedback.textContent = "This browser does not support the Web Speech API.";
      setInteractionState("error");
      return;
    }

    activeSessionId += 1;
    finalTranscript = "";
    interimTranscript = "";
    shouldAutoRestart = true;
    manualStop = false;
    resetResult();
    liveText.textContent = "Listening...";
    voiceFeedback.textContent = "Listening now. Speak naturally in one sentence or a few short phrases.";
    setInteractionState("listening");

    try {
      if (recognitionRunning) {
        recognition.abort();
      }
      recognition.start();
    } catch (_error) {
      voiceFeedback.textContent = "Voice recognition is already active. Try again in a moment.";
    }
  }

  async function handleStop() {
    const transcript = sanitizeTranscript(finalTranscript || interimTranscript || liveText.textContent);
    console.debug("[Voice] final transcript", { transcript, finalTranscript, interimTranscript });

    if (!transcript || transcript === "Listening...") {
      liveText.textContent = "No speech captured. Try again.";
      voiceFeedback.textContent = "I did not capture enough speech to understand that.";
      setInteractionState("error");
      return;
    }

    isParsing = true;
    setInteractionState("processing");
    voiceFeedback.textContent = "Understanding what you said...";

    try {
      parsedPreview = await window.voxaApi.parseVoiceCommand(transcript);
      console.debug("[Voice] parsed preview", parsedPreview);
    } catch (error) {
      isParsing = false;
      voiceFeedback.textContent = error.message || "Could not understand that request.";
      setInteractionState("error");
      return;
    }

    const previewUi = window.voxaCommandParser.formatPreview(parsedPreview);
    isParsing = false;
    spokenResult.textContent = transcript;
    parsedSummary.textContent = previewUi.headline;
    parsedConfidence.textContent = [
      `Action: ${previewUi.actionLabel}`,
      `Entity: ${previewUi.entityLabel}`,
      previewUi.targetLabel ? `Target: ${previewUi.targetLabel}` : "",
      ...previewUi.details.map((detail) => `${detail.label}: ${detail.value}`),
      previewUi.confidenceLabel,
    ]
      .filter(Boolean)
      .join("\n");
    matchedSuggestion.textContent =
      previewUi.suggestion ||
      (parsedPreview.needsConfirmation
        ? "Please review before you confirm."
        : "Looks good. Confirm when you are ready.");

    voiceResult.classList.remove("hidden");
    voiceFeedback.textContent = parsedPreview.needsConfirmation
      ? "Please confirm the suggestion before VoxaHabit makes any change."
      : "Review and confirm when you are ready.";
    setInteractionState("ready");
  }

  function stopVoice() {
    const instance = ensureRecognition();
    if (!instance || !isListening) {
      return;
    }

    shouldAutoRestart = false;
    manualStop = true;
    setInteractionState("processing");
    voiceFeedback.textContent = "Wrapping up your transcript...";
    instance.stop();
  }

  async function confirmVoice() {
    if (!parsedPreview) {
      return;
    }

    try {
      isParsing = true;
      setInteractionState("processing");
      voiceFeedback.textContent = parsedPreview.needsConfirmation
        ? "Applying the confirmed action..."
        : "Executing your request...";

      const result = await window.voxaApi.executeVoiceCommand(parsedPreview);
      console.debug("[Voice] execution result", result);
      isParsing = false;
      voiceState.textContent = "Completed";
      setVoiceTone("ready");
      voiceFeedback.textContent = result.message;
      window.setTimeout(() => {
        window.location.href = "/pages/app.html";
      }, 700);
    } catch (error) {
      isParsing = false;
      voiceFeedback.textContent = error.message || "Could not complete that action.";
      setInteractionState("error");
    }
  }

  function editVoice() {
    finalTranscript = "";
    interimTranscript = "";
    liveText.textContent = spokenResult.textContent || "Your speech will appear here in real time.";
    voiceFeedback.textContent = "Say it again with a small correction, then confirm the new suggestion.";
    resetResult();
    setInteractionState("idle");
  }

  function cancelVoice() {
    shouldAutoRestart = false;
    manualStop = false;
    finalTranscript = "";
    interimTranscript = "";
    liveText.textContent = "Your speech will appear here in real time.";
    voiceFeedback.textContent = "Nothing was changed. Start again whenever you are ready.";
    resetResult();
    setInteractionState("idle");
  }

  startButton.addEventListener("click", startVoice);
  stopButton.addEventListener("click", stopVoice);
  confirmButton.addEventListener("click", confirmVoice);
  editButton.addEventListener("click", editVoice);
  cancelButton.addEventListener("click", cancelVoice);

  ensureRecognition();
  setInteractionState("idle");
})();
