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
  const previewCards = document.getElementById("previewCards");
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
  let parsedPreviews = [];

  function sanitizeTranscript(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function resetResult() {
    voiceResult.classList.add("hidden");
    spokenResult.textContent = "";
    previewCards.innerHTML = "";
    parsedPreviews = [];
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

  function getConfidenceTone(confidence) {
    if (confidence >= 0.9) {
      return "high";
    }
    if (confidence >= 0.7) {
      return "medium";
    }
    return "low";
  }

  function getConfidenceMessage(confidence) {
    if (confidence >= 0.9) {
      return "High confidence";
    }
    if (confidence >= 0.7) {
      return "Some uncertainty";
    }
    return "Needs review";
  }

  function normalizePreviewCollection(previewResponse) {
    if (Array.isArray(previewResponse?.previews)) {
      return previewResponse.previews;
    }
    return previewResponse ? [previewResponse] : [];
  }

  function clonePreviews(previews) {
    return JSON.parse(JSON.stringify(previews));
  }

  function rerenderPreviewCards() {
    previewCards.innerHTML = parsedPreviews
      .map((preview, index) => {
        const previewUi = window.voxaCommandParser.formatPreview(preview);
        const confidencePercent = Math.round((previewUi.confidence || 0) * 100);
        const tone = getConfidenceTone(previewUi.confidence || 0);
        const suggestionText =
          previewUi.suggestion || previewUi.message || "Review this before you confirm.";

        return `
          <article class="voice-preview-card voice-preview-card--${tone}" data-preview-index="${index}">
            <div class="voice-preview-head">
              <div>
                <p class="result-label">I understood</p>
                <p class="result-text">${previewUi.headline}</p>
              </div>
              <div class="confidence-chip confidence-chip--${tone}">
                ${getConfidenceMessage(previewUi.confidence || 0)}
              </div>
            </div>
            <div class="confidence-meter">
              <span class="confidence-meter__bar confidence-meter__bar--${tone}" style="width:${confidencePercent}%"></span>
            </div>
            <p class="support-text">${suggestionText}</p>
            <div class="voice-preview-grid">
              <label class="field">
                <span>Title</span>
                <input type="text" data-field="target" value="${preview.command.target || preview.command.content || ""}" />
              </label>
              <label class="field">
                <span>Date</span>
                <input type="date" data-field="date" value="${preview.command.date || ""}" />
              </label>
              <label class="field">
                <span>Time</span>
                <input type="time" data-field="time" value="${preview.command.time || ""}" />
              </label>
            </div>
            <p class="result-text">${[
              `Action: ${previewUi.actionLabel}`,
              `Entity: ${previewUi.entityLabel}`,
              ...previewUi.details.map((detail) => `${detail.label}: ${detail.value}`),
              previewUi.confidenceLabel,
            ].join("\n")}</p>
          </article>
        `;
      })
      .join("");
  }

  function updatePreviewFromEdit(index, field, value) {
    const preview = parsedPreviews[index];
    if (!preview) {
      return;
    }

    const nextValue = sanitizeTranscript(value);
    if (field === "target") {
      preview.command.target = nextValue;
      preview.command.content = nextValue;
      if (preview.matchedItem && preview.matchedItem.title !== nextValue) {
        preview.matchedItem = null;
        preview.fuzzyMatched = false;
      }
    } else {
      preview.command[field] = nextValue;
    }

    const baseConfidence = Number(preview.command.confidence || preview.confidence || 0.6);
    preview.confidence = field === "target" ? Math.max(0.62, baseConfidence - 0.05) : Math.max(0.7, baseConfidence);
    preview.needsConfirmation = true;
    preview.suggestion = "Edited locally. Confirm this version when it looks right.";
    preview.understood = {
      ...(preview.understood || {}),
      targetLabel: preview.command.target || preview.command.content || "",
      details: [
        ...(preview.command.date ? [{ label: "Date", value: preview.command.date }] : []),
        ...(preview.command.time ? [{ label: "Time", value: preview.command.time }] : []),
        ...(preview.command.repeat && preview.command.repeat !== "none"
          ? [{ label: "Repeat", value: preview.command.repeat }]
          : []),
      ],
      headline:
        preview.command.action === "create"
          ? `Got it. I’ll work with "${preview.command.target || preview.command.content || "this item"}".`
          : `I think you want to ${preview.command.action} "${preview.command.target || preview.command.content || "this item"}".`,
    };

    rerenderPreviewCards();

    window.requestAnimationFrame(() => {
      const card = previewCards.querySelector(`[data-preview-index="${index}"]`);
      const input = card?.querySelector(`input[data-field="${field}"]`);
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
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
      const previewResponse = await window.voxaApi.parseVoiceCommand(transcript);
      parsedPreviews = clonePreviews(normalizePreviewCollection(previewResponse));
      console.debug("[Voice] parsed preview", parsedPreviews);
    } catch (error) {
      isParsing = false;
      voiceFeedback.textContent = error.message || "Could not understand that request.";
      setInteractionState("error");
      return;
    }

    isParsing = false;
    spokenResult.textContent = transcript;
    rerenderPreviewCards();
    voiceResult.classList.remove("hidden");
    voiceFeedback.textContent =
      parsedPreviews.length > 1
        ? "I found multiple actions. Please review each card before you confirm."
        : parsedPreviews[0]?.needsConfirmation
          ? "Please review the suggestion before VoxaHabit makes any change."
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
    if (!parsedPreviews.length) {
      return;
    }

    try {
      isParsing = true;
      setInteractionState("processing");
      voiceFeedback.textContent = parsedPreviews.some((preview) => preview.needsConfirmation)
        ? "Applying the confirmed action..."
        : "Executing your request...";

      const result = await window.voxaApi.executeVoiceCommand(
        parsedPreviews.length > 1 ? { previews: parsedPreviews } : parsedPreviews[0]
      );
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
    if (!parsedPreviews.length) {
      return;
    }
    voiceFeedback.textContent = "Edit the fields directly in the card, then confirm the updated version.";
    setInteractionState("ready");
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
  previewCards.addEventListener("input", (event) => {
    const input = event.target.closest("input[data-field]");
    const card = event.target.closest("[data-preview-index]");
    if (!input || !card) {
      return;
    }

    updatePreviewFromEdit(Number(card.dataset.previewIndex), input.dataset.field, input.value);
  });

  ensureRecognition();
  setInteractionState("idle");
})();
