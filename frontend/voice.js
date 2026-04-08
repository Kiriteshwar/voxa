(function voiceModule() {
  const page = document.body.dataset.page;
  if (page !== "voice") {
    return;
  }

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

  const TARGET_SAMPLE_RATE = 16000;
  const SEND_CHUNK_SAMPLES = 3200;

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

  let audioStream = null;
  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let sessionId = "";
  let sessionClosed = false;
  let eventSource = null;
  let isListening = false;
  let isParsing = false;
  let finalTranscript = "";
  let interimTranscript = "";
  let rawFinalTranscript = "";
  let rawInterimTranscript = "";
  let parsedPreviews = [];
  let queuedPcmChunks = [];
  let queuedPcmSamples = 0;
  let audioSendChain = Promise.resolve();
  let lastRenderedLiveText = "";

  function normalizeWhitespace(text = "") {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function splitWords(text = "") {
    return normalizeWhitespace(text).split(" ").filter(Boolean);
  }

  function collapseConsecutiveWordRepeats(text = "") {
    const words = splitWords(text);
    const compact = [];

    for (const word of words) {
      const current = word.toLowerCase();
      const previous = compact[compact.length - 1]?.toLowerCase();
      if (current && current === previous) {
        continue;
      }
      compact.push(word);
    }

    return compact.join(" ");
  }

  function collapseRepeatedTailPhrases(text = "") {
    const words = splitWords(text);
    if (words.length < 4) {
      return words.join(" ");
    }

    for (let phraseSize = Math.min(5, Math.floor(words.length / 2)); phraseSize >= 2; phraseSize -= 1) {
      const tail = words.slice(-phraseSize).join(" ").toLowerCase();
      const previous = words.slice(-phraseSize * 2, -phraseSize).join(" ").toLowerCase();
      if (tail && tail === previous) {
        return words.slice(0, -phraseSize).join(" ");
      }
    }

    return words.join(" ");
  }

  function sanitizeTranscript(text = "") {
    return normalizeWhitespace(collapseRepeatedTailPhrases(collapseConsecutiveWordRepeats(text)));
  }

  function resetTranscriptState() {
    finalTranscript = "";
    interimTranscript = "";
    rawFinalTranscript = "";
    rawInterimTranscript = "";
    queuedPcmChunks = [];
    queuedPcmSamples = 0;
    audioSendChain = Promise.resolve();
    lastRenderedLiveText = "";
  }

  function renderLiveTranscript() {
    const combinedText = sanitizeTranscript([finalTranscript, interimTranscript].filter(Boolean).join(" ")) || "Listening...";
    if (combinedText !== lastRenderedLiveText) {
      liveText.textContent = combinedText;
      lastRenderedLiveText = combinedText;
    }
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
        const suggestionText = previewUi.suggestion || previewUi.message || "Review this before you confirm.";

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
        ...(preview.command.repeat && preview.command.repeat !== "none" ? [{ label: "Repeat", value: preview.command.repeat }] : []),
      ],
      headline:
        preview.command.action === "create"
          ? `Got it. I'll work with "${preview.command.target || preview.command.content || "this item"}".`
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

  function downsampleTo16k(inputData, inputSampleRate) {
    if (!inputData?.length) {
      return new Int16Array(0);
    }

    if (inputSampleRate === TARGET_SAMPLE_RATE) {
      const output = new Int16Array(inputData.length);
      for (let index = 0; index < inputData.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, inputData[index]));
        output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      return output;
    }

    const sampleRateRatio = inputSampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.round(inputData.length / sampleRateRatio);
    const output = new Int16Array(outputLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < outputLength) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accumulator = 0;
      let count = 0;
      for (let index = offsetBuffer; index < Math.min(nextOffsetBuffer, inputData.length); index += 1) {
        accumulator += inputData[index];
        count += 1;
      }
      const sample = count ? accumulator / count : 0;
      const normalizedSample = Math.max(-1, Math.min(1, sample));
      output[offsetResult] = normalizedSample < 0 ? normalizedSample * 0x8000 : normalizedSample * 0x7fff;
      offsetResult += 1;
      offsetBuffer = nextOffsetBuffer;
    }

    return output;
  }

  function enqueuePcmChunk(pcmChunk) {
    if (!pcmChunk?.length) {
      return;
    }

    queuedPcmChunks.push(pcmChunk);
    queuedPcmSamples += pcmChunk.length;
    flushQueuedPcm();
  }

  function takeQueuedPcm(sampleCount) {
    const target = new Int16Array(sampleCount);
    let offset = 0;

    while (offset < sampleCount && queuedPcmChunks.length) {
      const current = queuedPcmChunks[0];
      const copyLength = Math.min(current.length, sampleCount - offset);
      target.set(current.subarray(0, copyLength), offset);
      offset += copyLength;

      if (copyLength === current.length) {
        queuedPcmChunks.shift();
      } else {
        queuedPcmChunks[0] = current.subarray(copyLength);
      }
    }

    queuedPcmSamples -= sampleCount;
    return target;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return window.btoa(binary);
  }

  function queueAudioUpload(pcmChunk) {
    if (!sessionId || sessionClosed || !pcmChunk?.length) {
      return;
    }

    const base64Audio = arrayBufferToBase64(pcmChunk.buffer.slice(0));
    audioSendChain = audioSendChain
      .then(() => window.voxaApi.sendVoiceAudioChunk(sessionId, base64Audio))
      .catch((error) => {
        console.debug("[AssemblyAI] audio upload error", error);
        voiceFeedback.textContent = error.message || "Audio streaming was interrupted.";
        setInteractionState("error");
      });
  }

  function flushQueuedPcm(force = false) {
    const requiredSamples = force ? queuedPcmSamples : Math.max(SEND_CHUNK_SAMPLES, 1);

    while (queuedPcmSamples >= requiredSamples && queuedPcmSamples > 0) {
      const sampleCount = force ? queuedPcmSamples : SEND_CHUNK_SAMPLES;
      const chunk = takeQueuedPcm(sampleCount);
      queueAudioUpload(chunk);
      if (force) {
        break;
      }
    }
  }

  async function setupAudioCapture() {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    sourceNode = audioContext.createMediaStreamSource(audioStream);
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);

    processorNode.onaudioprocess = (event) => {
      if (!isListening || sessionClosed) {
        return;
      }

      const channelData = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleTo16k(channelData, audioContext.sampleRate);
      enqueuePcmChunk(downsampled);
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);
  }

  function teardownAudioCapture() {
    try {
      processorNode?.disconnect();
    } catch (_error) {}
    try {
      sourceNode?.disconnect();
    } catch (_error) {}
    try {
      audioStream?.getTracks().forEach((track) => track.stop());
    } catch (_error) {}
    try {
      audioContext?.close();
    } catch (_error) {}

    processorNode = null;
    sourceNode = null;
    audioStream = null;
    audioContext = null;
  }

  function connectTranscriptEvents(currentSessionId) {
    eventSource = window.voxaApi.createVoiceEventsStream(currentSessionId, {
      onTranscript(payload) {
        rawFinalTranscript = payload.finalTranscript || rawFinalTranscript;
        rawInterimTranscript = payload.interimTranscript || "";
        finalTranscript = sanitizeTranscript(payload.finalTranscript || finalTranscript);
        interimTranscript = sanitizeTranscript(payload.interimTranscript || "");
        renderLiveTranscript();
        console.debug("[AssemblyAI] transcript", payload);
      },
      onError(payload) {
        console.debug("[AssemblyAI] stream error", payload);
        if (isListening || isParsing) {
          voiceFeedback.textContent = payload.message || "Voice streaming was interrupted.";
          setInteractionState("error");
        }
      },
      onEvent(eventName, payload) {
        console.debug("[AssemblyAI] event", eventName, payload);
      },
    });
  }

  async function startVoice() {
    if (!navigator.mediaDevices?.getUserMedia) {
      voiceFeedback.textContent = "This browser does not support live microphone capture.";
      setInteractionState("error");
      return;
    }

    try {
      resetTranscriptState();
      resetResult();
      sessionClosed = false;
      liveText.textContent = "Connecting to AssemblyAI...";
      voiceFeedback.textContent = "Preparing your microphone and live transcription...";
      setInteractionState("processing");

      const session = await window.voxaApi.startVoiceStream();
      sessionId = session.sessionId;
      connectTranscriptEvents(sessionId);
      await setupAudioCapture();

      voiceFeedback.textContent = "Listening now. Speak naturally and stop when you're ready.";
      setInteractionState("listening");
      renderLiveTranscript();
    } catch (error) {
      console.debug("[AssemblyAI] start error", error);
      teardownAudioCapture();
      eventSource?.close();
      eventSource = null;
      sessionId = "";
      voiceFeedback.textContent = error.message || "Could not start voice streaming.";
      setInteractionState("error");
    }
  }

  async function handleStop(finalizedTranscript = "") {
    const transcript = sanitizeTranscript(finalizedTranscript || rawFinalTranscript || rawInterimTranscript || finalTranscript || interimTranscript);
    console.debug("[AssemblyAI] final transcript", {
      transcript,
      rawFinalTranscript,
      rawInterimTranscript,
    });

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

  async function stopVoice() {
    if (!isListening && !sessionId) {
      return;
    }

    setInteractionState("processing");
    voiceFeedback.textContent = "Finalizing your transcript...";
    isListening = false;
    sessionClosed = true;

    teardownAudioCapture();
    flushQueuedPcm(true);

    try {
      await audioSendChain;
      const payload = sessionId ? await window.voxaApi.stopVoiceStream(sessionId) : { finalTranscript: "" };
      eventSource?.close();
      eventSource = null;
      const finalText = payload.finalTranscript || rawFinalTranscript || rawInterimTranscript;
      sessionId = "";
      await handleStop(finalText);
    } catch (error) {
      console.debug("[AssemblyAI] stop error", error);
      eventSource?.close();
      eventSource = null;
      sessionId = "";
      voiceFeedback.textContent = error.message || "Could not stop voice streaming cleanly.";
      setInteractionState("error");
    }
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

      const result = await window.voxaApi.executeVoiceCommand(parsedPreviews.length > 1 ? { previews: parsedPreviews } : parsedPreviews[0]);
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
    sessionClosed = true;
    eventSource?.close();
    eventSource = null;
    if (sessionId) {
      window.voxaApi.stopVoiceStream(sessionId).catch(() => {});
      sessionId = "";
    }
    teardownAudioCapture();
    resetTranscriptState();
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

  setInteractionState("idle");
})();
