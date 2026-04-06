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

  const currentUser = window.voxaApi.getCurrentUser();
  document.getElementById("voiceUserEmail").textContent = currentUser?.email || "";

  const startButton = document.getElementById("startVoiceButton");
  const stopButton = document.getElementById("stopVoiceButton");
  const liveText = document.getElementById("liveText");
  const voiceState = document.getElementById("voiceState");
  const voiceFeedback = document.getElementById("voiceFeedback");
  const voiceResult = document.getElementById("voiceResult");
  const spokenResult = document.getElementById("spokenResult");
  const parsedSummary = document.getElementById("parsedSummary");
  const parsedConfidence = document.getElementById("parsedConfidence");
  const confirmButton = document.getElementById("confirmVoiceButton");
  const retryButton = document.getElementById("retryVoiceButton");
  const micOrb = document.getElementById("micOrb");

  let recognition = null;
  let activeSessionId = 0;
  let isListening = false;
  let isParsing = false;
  let stopRequested = false;
  let finalTranscript = "";
  let interimTranscript = "";
  let parsedCommand = null;

  function sanitizeTranscript(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function resetResult() {
    voiceResult.classList.add("hidden");
    spokenResult.textContent = "";
    parsedSummary.textContent = "";
    parsedConfidence.textContent = "";
    parsedCommand = null;
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
    retryButton.disabled = isParsing;
  }

  function formatCommandSummary(command) {
    const fragments = [
      `${command.action} ${command.type}`,
      command.title ? `"${command.title}"` : "",
      command.category && command.category !== "general" ? `in ${command.category}` : "",
      command.date ? `on ${command.date}` : "",
      command.time ? `at ${command.time}` : "",
      command.repeat ? `repeat ${command.repeat}` : "",
    ].filter(Boolean);

    return fragments.join(" | ");
  }

  function formatConfidence(command) {
    const percentage = Math.round((command.confidence || 0) * 100);
    if (percentage >= 80) {
      return `${percentage}% confidence | strong match`;
    }
    if (percentage >= 60) {
      return `${percentage}% confidence | looks good, please review`;
    }
    return `${percentage}% confidence | ambiguous, review before confirming`;
  }

  function buildRecognition(sessionId) {
    if (!recognitionApi) {
      voiceFeedback.textContent = "This browser does not support the Web Speech API.";
      startButton.disabled = true;
      setInteractionState("error");
      return null;
    }

    const instance = new recognitionApi();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = "en-US";

    instance.onresult = (event) => {
      if (sessionId !== activeSessionId) {
        return;
      }

      const finalParts = [];
      const interimParts = [];

      for (let index = 0; index < event.results.length; index += 1) {
        const transcript = sanitizeTranscript(event.results[index][0].transcript);
        if (!transcript) {
          continue;
        }

        if (event.results[index].isFinal) {
          finalParts.push(transcript);
        } else {
          interimParts.push(transcript);
        }
      }

      finalTranscript = sanitizeTranscript(finalParts.join(" "));
      interimTranscript = sanitizeTranscript(interimParts.join(" "));
      liveText.textContent = sanitizeTranscript(
        [finalTranscript, interimTranscript].filter(Boolean).join(" ")
      ) || "Listening...";

      console.debug("[Voice] transcript update", {
        sessionId,
        finalTranscript,
        interimTranscript,
        liveText: liveText.textContent,
      });
    };

    instance.onerror = (event) => {
      if (sessionId !== activeSessionId) {
        return;
      }

      stopRequested = false;
      voiceFeedback.textContent = `Voice error: ${event.error}`;
      setInteractionState("error");
    };

    instance.onend = () => {
      if (sessionId !== activeSessionId) {
        return;
      }

      if (stopRequested) {
        stopRequested = false;
        handleStop();
        return;
      }

      if (isListening) {
        try {
          instance.start();
        } catch (_error) {
          voiceFeedback.textContent = "Listening paused. Tap start to try again.";
          setInteractionState("error");
        }
      }
    };

    return instance;
  }

  function startVoice() {
    activeSessionId += 1;
    finalTranscript = "";
    interimTranscript = "";
    stopRequested = false;
    liveText.textContent = "Listening...";
    voiceFeedback.textContent = "Speak naturally. VoxaHabit is transcribing in real time.";
    resetResult();
    setInteractionState("listening");

    if (recognition) {
      try {
        recognition.onend = null;
        recognition.abort();
      } catch (_error) {
        console.debug("[Voice] previous session cleanup skipped");
      }
    }

    recognition = buildRecognition(activeSessionId);
    if (!recognition) {
      return;
    }

    recognition.start();
  }

  async function handleStop() {
    const transcript = sanitizeTranscript(finalTranscript) || sanitizeTranscript(interimTranscript);
    console.debug("[Voice] final transcript", {
      sessionId: activeSessionId,
      finalTranscript,
      interimTranscript,
      transcript,
    });

    if (!transcript || transcript === "Listening...") {
      liveText.textContent = "No speech captured. Try again.";
      voiceFeedback.textContent = "We did not catch anything that time.";
      setInteractionState("error");
      return;
    }

    isParsing = true;
    setInteractionState("processing");
    voiceFeedback.textContent = "Understanding what you said...";

    try {
      parsedCommand = await window.voxaApi.parseVoiceCommand(transcript);
      console.debug("[Voice] parsed result", parsedCommand);
    } catch (error) {
      isParsing = false;
      voiceFeedback.textContent = error.message || "Could not understand that request.";
      setInteractionState("error");
      return;
    }

    isParsing = false;
    spokenResult.textContent = transcript;
    parsedSummary.textContent = formatCommandSummary(parsedCommand);
    parsedConfidence.textContent = formatConfidence(parsedCommand);
    voiceResult.classList.remove("hidden");
    voiceFeedback.textContent = "Review the command and confirm if it looks right.";
    setInteractionState("ready");
  }

  function stopVoice() {
    if (!recognition || !isListening) {
      return;
    }

    stopRequested = true;
    setInteractionState("processing");
    voiceFeedback.textContent = "Wrapping up your transcript...";
    recognition.stop();
  }

  async function confirmVoice() {
    if (!parsedCommand) {
      return;
    }

    try {
      isParsing = true;
      setInteractionState("processing");
      voiceFeedback.textContent = "Applying your request...";
      const result = await window.voxaApi.executeVoiceCommand(parsedCommand);
      console.debug("[Voice] API execution result", result);
      isParsing = false;
      voiceState.textContent = "Completed";
      setVoiceTone("ready");
      voiceFeedback.textContent = result.message;
      setTimeout(() => {
        window.location.href = "/pages/app.html";
      }, 700);
    } catch (error) {
      isParsing = false;
      voiceFeedback.textContent = error.message;
      setInteractionState("error");
    }
  }

  function retryVoice() {
    stopRequested = false;
    finalTranscript = "";
    interimTranscript = "";
    liveText.textContent = "Your speech will appear here in real time.";
    voiceFeedback.textContent = "Try again. Speak clearly and keep the command short.";
    resetResult();
    setInteractionState("idle");
  }

  startButton.addEventListener("click", startVoice);
  stopButton.addEventListener("click", stopVoice);
  confirmButton.addEventListener("click", confirmVoice);
  retryButton.addEventListener("click", retryVoice);

  setInteractionState("idle");
})();
