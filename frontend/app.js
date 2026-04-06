const state = {
  user: null,
  parsedCommand: null,
  habits: [],
  notes: [],
  reminders: [],
  logs: [],
  analytics: null,
  activeAlarm: null,
  alarmLoopId: null,
  firedReminderIds: new Set(),
  syncIntervalId: null,
  reminderIntervalId: null,
  recognizer: null,
  isListening: false,
};

const elements = {
  authForm: document.getElementById("authForm"),
  registerButton: document.getElementById("registerButton"),
  logoutButton: document.getElementById("logoutButton"),
  authStatus: document.getElementById("authStatus"),
  commandForm: document.getElementById("commandForm"),
  commandText: document.getElementById("commandText"),
  commandOutput: document.getElementById("commandOutput"),
  executeCommandButton: document.getElementById("executeCommandButton"),
  voiceButton: document.getElementById("voiceButton"),
  habitForm: document.getElementById("habitForm"),
  habitName: document.getElementById("habitName"),
  habitRepeat: document.getElementById("habitRepeat"),
  habitDate: document.getElementById("habitDate"),
  habitTime: document.getElementById("habitTime"),
  habitList: document.getElementById("habitList"),
  habitCount: document.getElementById("habitCount"),
  noteForm: document.getElementById("noteForm"),
  noteId: document.getElementById("noteId"),
  noteTitle: document.getElementById("noteTitle"),
  noteContent: document.getElementById("noteContent"),
  noteList: document.getElementById("noteList"),
  noteCount: document.getElementById("noteCount"),
  clearNoteButton: document.getElementById("clearNoteButton"),
  reminderForm: document.getElementById("reminderForm"),
  reminderId: document.getElementById("reminderId"),
  reminderTitle: document.getElementById("reminderTitle"),
  reminderDate: document.getElementById("reminderDate"),
  reminderTime: document.getElementById("reminderTime"),
  reminderMessage: document.getElementById("reminderMessage"),
  reminderList: document.getElementById("reminderList"),
  reminderCount: document.getElementById("reminderCount"),
  clearReminderButton: document.getElementById("clearReminderButton"),
  reminderStatus: document.getElementById("reminderStatus"),
  notificationButton: document.getElementById("notificationButton"),
  analyticsCards: document.getElementById("analyticsCards"),
  analyticsDetails: document.getElementById("analyticsDetails"),
  upcomingList: document.getElementById("upcomingList"),
  historyList: document.getElementById("historyList"),
  alarmPanel: document.getElementById("alarmPanel"),
  alarmTitle: document.getElementById("alarmTitle"),
  alarmMessage: document.getElementById("alarmMessage"),
  snoozeActiveReminder: document.getElementById("snoozeActiveReminder"),
  stopActiveReminder: document.getElementById("stopActiveReminder"),
};

function setStatus(message, isError = false) {
  elements.authStatus.textContent = message;
  elements.authStatus.className = isError ? "status-skipped" : "muted";
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatCommandOutput(command, source, execution) {
  elements.commandOutput.textContent = JSON.stringify(
    { source, command, execution: execution || null },
    null,
    2
  );
}

function updateAuthUI() {
  if (state.user) {
    setStatus(`Signed in as ${state.user.email}`);
  } else {
    setStatus("Sign in to sync your workspace.");
  }
}

function renderHabits() {
  elements.habitCount.textContent = `${state.habits.length} habits`;
  if (!state.habits.length) {
    elements.habitList.innerHTML = '<div class="muted">No habits yet. Add one or speak one.</div>';
    return;
  }

  elements.habitList.innerHTML = state.habits
    .map(
      (habit) => `
        <article class="card">
          <div>
            <h3>${habit.name}</h3>
            <div class="card__meta">
              <span>${habit.repeat}</span>
              <span>${habit.scheduledDate || "Any date"}</span>
              <span>${habit.time || "Any time"}</span>
              <span class="status-${habit.todayStatus || habit.status}">
                ${habit.todayStatus || habit.status}
              </span>
            </div>
          </div>
          <div class="card__actions">
            <button type="button" data-action="complete" data-id="${habit._id}">Done</button>
            <button type="button" class="secondary" data-action="skip" data-id="${habit._id}">Skip</button>
            <button type="button" class="secondary" data-action="delete" data-id="${habit._id}">Delete</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderNotes() {
  elements.noteCount.textContent = `${state.notes.length} notes`;
  if (!state.notes.length) {
    elements.noteList.innerHTML = '<div class="muted">No notes yet.</div>';
    return;
  }

  elements.noteList.innerHTML = state.notes
    .map(
      (note) => `
        <article class="card">
          <div>
            <h3>${note.title}</h3>
            <div class="muted">${note.content}</div>
          </div>
          <div class="card__meta">
            <span>Updated ${formatDateTime(note.updatedAt)}</span>
          </div>
          <div class="card__actions">
            <button type="button" data-action="edit" data-id="${note._id}">Edit</button>
            <button type="button" class="secondary" data-action="delete" data-id="${note._id}">
              Delete
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderReminders() {
  elements.reminderCount.textContent = `${state.reminders.length} reminders`;
  if (!state.reminders.length) {
    elements.reminderList.innerHTML = '<div class="muted">No reminders scheduled yet.</div>';
    return;
  }

  elements.reminderList.innerHTML = state.reminders
    .map(
      (reminder) => `
        <article class="card">
          <div>
            <h3>${reminder.title}</h3>
            <div class="muted">${reminder.message || "No extra message"}</div>
          </div>
          <div class="card__meta">
            <span>${formatDateTime(reminder.scheduledFor)}</span>
            <span class="status-${reminder.status}">${reminder.status}</span>
          </div>
          <div class="card__actions">
            <button type="button" data-action="edit" data-id="${reminder._id}">Edit</button>
            <button type="button" data-action="snooze" data-id="${reminder._id}">Snooze</button>
            <button type="button" class="secondary" data-action="stop" data-id="${reminder._id}">Stop</button>
            <button type="button" class="secondary" data-action="delete" data-id="${reminder._id}">
              Delete
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderHistory() {
  if (!state.logs.length) {
    elements.historyList.innerHTML = '<div class="muted">Habit history will appear here.</div>';
    return;
  }

  const habitMap = new Map(state.habits.map((habit) => [habit._id, habit.name]));
  elements.historyList.innerHTML = state.logs
    .map(
      (log) => `
        <article class="card">
          <strong>${habitMap.get(log.habitId) || "Habit"}</strong>
          <div class="card__meta">
            <span>${log.date}</span>
            <span class="status-${log.status}">${log.status}</span>
            <span>${log.source || "manual"}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderAnalytics() {
  if (!state.analytics) {
    elements.analyticsCards.innerHTML = "";
    elements.analyticsDetails.innerHTML = '<div class="muted">Analytics will load after sign in.</div>';
    return;
  }

  const { overview, weekly, monthly, habits, missedHabits } = state.analytics;
  const cards = [
    { label: "Habits", value: overview.totalHabits },
    { label: "Notes", value: overview.totalNotes },
    { label: "Reminders", value: overview.totalReminders },
    { label: "Completion", value: `${overview.overallCompletionRate}%` },
    { label: "Weekly done", value: weekly.completed },
    { label: "Monthly done", value: monthly.completed },
  ];

  elements.analyticsCards.innerHTML = cards
    .map(
      (card) => `
        <div class="stat-card">
          <span>${card.label}</span>
          <strong>${card.value}</strong>
        </div>
      `
    )
    .join("");

  elements.analyticsDetails.innerHTML = `
    <article class="card">
      <h3>Habit performance</h3>
      ${
        habits.length
          ? habits
              .map(
                (habit) =>
                  `<div>${habit.name}: ${habit.streak} day streak, ${habit.completionRate}% completion</div>`
              )
              .join("")
          : '<div class="muted">No analytics yet.</div>'
      }
    </article>
    <article class="card">
      <h3>Needs attention</h3>
      ${
        missedHabits.length
          ? missedHabits.map((habit) => `<div>${habit.name}</div>`).join("")
          : '<div class="muted">Nothing flagged right now.</div>'
      }
    </article>
  `;
}

function getNextHabitOccurrence(habit) {
  if (!habit.time) {
    return null;
  }

  const now = new Date();
  const [hours, minutes] = habit.time.split(":").map(Number);
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);

  if (habit.repeat === "daily") {
    if (next < now) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if ((habit.repeat === "custom" || habit.repeat === "none") && habit.scheduledDate) {
    return new Date(`${habit.scheduledDate}T${habit.time}:00`);
  }

  if (habit.repeat === "weekly") {
    if (habit.scheduledDate) {
      const scheduled = new Date(`${habit.scheduledDate}T${habit.time}:00`);
      while (scheduled < now) {
        scheduled.setDate(scheduled.getDate() + 7);
      }
      return scheduled;
    }
    if (next < now) {
      next.setDate(next.getDate() + 7);
    }
    return next;
  }

  return next >= now ? next : null;
}

function renderUpcoming() {
  const items = [
    ...state.reminders
      .filter((reminder) => reminder.status !== "dismissed")
      .map((reminder) => ({
        id: reminder._id,
        kind: "Reminder",
        title: reminder.title,
        when: new Date(reminder.scheduledFor),
      })),
    ...state.habits
      .map((habit) => {
        const when = getNextHabitOccurrence(habit);
        if (!when) {
          return null;
        }

        return {
          id: habit._id,
          kind: "Habit",
          title: habit.name,
          when,
        };
      })
      .filter(Boolean),
  ]
    .sort((a, b) => a.when - b.when)
    .slice(0, 8);

  if (!items.length) {
    elements.upcomingList.innerHTML = '<div class="muted">No upcoming tasks yet.</div>';
    return;
  }

  elements.upcomingList.innerHTML = items
    .map(
      (item) => `
        <article class="card">
          <strong>${item.kind}: ${item.title}</strong>
          <div class="muted">${formatDateTime(item.when)}</div>
        </article>
      `
    )
    .join("");
}

function resetNoteForm() {
  elements.noteForm.reset();
  elements.noteId.value = "";
}

function resetReminderForm() {
  elements.reminderForm.reset();
  elements.reminderId.value = "";
}

function renderAll() {
  updateAuthUI();
  renderHabits();
  renderNotes();
  renderReminders();
  renderAnalytics();
  renderHistory();
  renderUpcoming();
}

async function refreshDashboard() {
  if (!api.getToken()) {
    state.user = null;
    state.habits = [];
    state.notes = [];
    state.reminders = [];
    state.logs = [];
    state.analytics = null;
    renderAll();
    return;
  }

  try {
    const [{ user }, habits, notes, reminders, logs, analytics] = await Promise.all([
      api.me(),
      api.getHabits(),
      api.getNotes(),
      api.getReminders(),
      api.getLogs(),
      api.getAnalytics(),
    ]);

    state.user = user;
    state.habits = habits;
    state.notes = notes;
    state.reminders = reminders;
    state.logs = logs;
    state.analytics = analytics;
    syncTriggeredReminders();
    renderAll();
    checkDueReminders();
  } catch (error) {
    api.clearToken();
    state.user = null;
    renderAll();
    setStatus(error.message, true);
  }
}

function startAutoSync() {
  if (state.syncIntervalId) {
    clearInterval(state.syncIntervalId);
  }
  if (state.reminderIntervalId) {
    clearInterval(state.reminderIntervalId);
  }

  state.syncIntervalId = window.setInterval(() => {
    refreshDashboard().catch((error) => setStatus(error.message, true));
  }, 30000);

  state.reminderIntervalId = window.setInterval(checkDueReminders, 15000);
}

async function handleAuth(mode) {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const action = mode === "register" ? api.register : api.login;
  const response = await action({ email, password });

  api.setToken(response.token);
  state.user = response.user;
  updateAuthUI();
  await refreshDashboard();
}

async function handleParseCommand() {
  const text = elements.commandText.value.trim();
  const response = await aiService.parseCommand(text);
  state.parsedCommand = response.command;
  formatCommandOutput(response.command, response.source);
}

async function handleExecuteCommand() {
  if (!api.getToken()) {
    throw new Error("Please login before executing voice actions");
  }

  const text = elements.commandText.value.trim();
  const payload = state.parsedCommand ? { command: state.parsedCommand, text } : { text };
  const response = await api.executeCommand(payload);
  state.parsedCommand = response.command;
  formatCommandOutput(response.command, response.source, response.execution);
  await refreshDashboard();
}

function startAlarm(reminder) {
  state.activeAlarm = reminder;
  elements.alarmTitle.textContent = reminder.title;
  elements.alarmMessage.textContent = reminder.message || formatDateTime(reminder.scheduledFor);
  elements.alarmPanel.classList.remove("hidden");

  if (state.alarmLoopId) {
    clearInterval(state.alarmLoopId);
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  const audioContext = new AudioContextClass();
  const playBeep = () => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gainNode.gain.value = 0.02;
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
  };

  playBeep();
  state.alarmLoopId = window.setInterval(playBeep, 1500);

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("VoxaHabit reminder", {
      body: reminder.title,
    });
  }
}

function stopAlarmUi() {
  if (state.alarmLoopId) {
    clearInterval(state.alarmLoopId);
    state.alarmLoopId = null;
  }
  state.activeAlarm = null;
  elements.alarmPanel.classList.add("hidden");
}

function syncTriggeredReminders() {
  const now = Date.now();
  state.reminders.forEach((reminder) => {
    if (new Date(reminder.scheduledFor).getTime() > now || reminder.status === "dismissed") {
      state.firedReminderIds.delete(reminder._id);
    }
  });
}

function checkDueReminders() {
  if (!state.user || state.activeAlarm) {
    return;
  }

  const dueReminder = state.reminders.find((reminder) => {
    if (!["active", "snoozed"].includes(reminder.status)) {
      return false;
    }

    if (state.firedReminderIds.has(reminder._id)) {
      return false;
    }

    return new Date(reminder.scheduledFor).getTime() <= Date.now();
  });

  if (dueReminder) {
    state.firedReminderIds.add(dueReminder._id);
    startAlarm(dueReminder);
  }
}

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await handleAuth("login");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.registerButton.addEventListener("click", async () => {
  try {
    await handleAuth("register");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.logoutButton.addEventListener("click", () => {
  api.clearToken();
  stopAlarmUi();
  refreshDashboard().catch((error) => setStatus(error.message, true));
});

elements.commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await handleParseCommand();
  } catch (error) {
    elements.commandOutput.textContent = error.message;
  }
});

elements.executeCommandButton.addEventListener("click", async () => {
  try {
    await handleExecuteCommand();
  } catch (error) {
    elements.commandOutput.textContent = error.message;
  }
});

elements.habitForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api.createHabit({
      name: elements.habitName.value.trim(),
      repeat: elements.habitRepeat.value,
      scheduledDate: elements.habitDate.value,
      time: elements.habitTime.value,
    });
    elements.habitForm.reset();
    await refreshDashboard();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.habitList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;
  try {
    if (action === "delete") {
      await api.deleteHabit(id);
    } else {
      await api.markHabit(id, {
        status: action === "complete" ? "completed" : "skipped",
      });
    }
    await refreshDashboard();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = {
      title: elements.noteTitle.value.trim(),
      content: elements.noteContent.value.trim(),
    };

    if (elements.noteId.value) {
      await api.updateNote(elements.noteId.value, payload);
    } else {
      await api.createNote(payload);
    }

    resetNoteForm();
    await refreshDashboard();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.noteList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const note = state.notes.find((item) => item._id === button.dataset.id);
  if (!note) {
    return;
  }

  if (button.dataset.action === "edit") {
    elements.noteId.value = note._id;
    elements.noteTitle.value = note.title;
    elements.noteContent.value = note.content;
    return;
  }

  try {
    await api.deleteNote(note._id);
    await refreshDashboard();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.clearNoteButton.addEventListener("click", resetNoteForm);

elements.reminderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = {
      title: elements.reminderTitle.value.trim(),
      message: elements.reminderMessage.value.trim(),
      date: elements.reminderDate.value,
      time: elements.reminderTime.value,
    };

    if (elements.reminderId.value) {
      await api.updateReminder(elements.reminderId.value, payload);
    } else {
      await api.createReminder(payload);
    }

    resetReminderForm();
    await refreshDashboard();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.reminderList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const reminder = state.reminders.find((item) => item._id === button.dataset.id);
  if (!reminder) {
    return;
  }

  if (button.dataset.action === "edit") {
    elements.reminderId.value = reminder._id;
    elements.reminderTitle.value = reminder.title;
    elements.reminderMessage.value = reminder.message || "";
    elements.reminderDate.value = new Date(reminder.scheduledFor).toISOString().slice(0, 10);
    elements.reminderTime.value = new Date(reminder.scheduledFor).toTimeString().slice(0, 5);
    return;
  }

  try {
    if (button.dataset.action === "delete") {
      await api.deleteReminder(reminder._id);
    } else if (button.dataset.action === "snooze") {
      await api.snoozeReminder(reminder._id, { minutes: 10 });
    } else if (button.dataset.action === "stop") {
      await api.stopReminder(reminder._id);
    }

    if (state.activeAlarm?._id === reminder._id) {
      stopAlarmUi();
    }

    await refreshDashboard();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.clearReminderButton.addEventListener("click", resetReminderForm);

elements.notificationButton.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    elements.reminderStatus.textContent = "Notifications are not supported in this browser.";
    return;
  }

  const permission = await Notification.requestPermission();
  elements.reminderStatus.textContent = `Browser alert permission: ${permission}`;
});

elements.snoozeActiveReminder.addEventListener("click", async () => {
  if (!state.activeAlarm) {
    return;
  }

  await api.snoozeReminder(state.activeAlarm._id, { minutes: 10 });
  stopAlarmUi();
  await refreshDashboard();
});

elements.stopActiveReminder.addEventListener("click", async () => {
  if (!state.activeAlarm) {
    return;
  }

  await api.stopReminder(state.activeAlarm._id);
  stopAlarmUi();
  await refreshDashboard();
});

elements.voiceButton.addEventListener("click", () => {
  if (!voiceService.supported) {
    elements.commandOutput.textContent = "Speech recognition is not supported in this browser.";
    return;
  }

  if (!state.recognizer) {
    state.recognizer = voiceService.createRecognizer(
      async (transcript) => {
        elements.commandText.value = transcript;
        await handleParseCommand();
        if (api.getToken()) {
          await handleExecuteCommand();
        }
      },
      (error) => {
        elements.commandOutput.textContent = `Voice recognition error: ${error}`;
      },
      (status) => {
        state.isListening = status === "listening";
        elements.voiceButton.textContent = state.isListening ? "Listening..." : "Start voice";
      }
    );
  }

  if (!state.isListening) {
    state.recognizer.start();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

startAutoSync();
refreshDashboard().catch((error) => setStatus(error.message, true));
