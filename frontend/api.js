const STORAGE_KEYS = {
  token: "voxa_token",
  user: "voxa_current_user",
  voiceUndo: "voxa_voice_undo",
  apiBase: "voxa_api_base",
};

function normalizeApiBase(value = "") {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function resolveApiBase() {
  return "https://voxa-production-de05.up.railway.app/api";
}

function getApiBase() {
  return resolveApiBase();
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toLocalDateInputValue(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toLocalTimeInputValue(value) {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function setSession(token, user) {
  localStorage.setItem(STORAGE_KEYS.token, token);
  writeJson(STORAGE_KEYS.user, user);
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.user);
}

function setVoiceUndo(payload) {
  writeJson(STORAGE_KEYS.voiceUndo, payload);
}

function getVoiceUndo() {
  return readJson(STORAGE_KEYS.voiceUndo, null);
}

function clearVoiceUndo() {
  localStorage.removeItem(STORAGE_KEYS.voiceUndo);
}

function dispatchDataUpdated(source) {
  window.dispatchEvent(new CustomEvent("voxa:data-updated", { detail: { source } }));
}

function debugLog(label, payload) {
  console.debug(`[VoxaAPI] ${label}`, payload);
}

function normalizeStatus(status) {
  if (status === "completed" || status === "done") {
    return "completed";
  }

  if (status === "skipped" || status === "dismissed" || status === "cancelled") {
    return "missed";
  }

  return "pending";
}

function getHabitVisualStatus(habit, logs) {
  if (habit.todayStatus === "completed") {
    return "completed";
  }

  if (habit.todayStatus === "skipped") {
    return "missed";
  }

  const now = new Date();
  const today = getTodayKey();

  if (habit.date && habit.date < today) {
    return "missed";
  }

  if (habit.date === today && habit.time) {
    const dueTime = new Date(`${habit.date}T${habit.time}:00`);
    if (dueTime < now) {
      return "missed";
    }
  }

  if (!habit.date && habit.time && habit.repeat === "daily") {
    const dueTime = new Date(`${today}T${habit.time}:00`);
    if (dueTime < now && !logs.some((log) => log.habitId === habit.id && log.date === today)) {
      return "missed";
    }
  }

  return "pending";
}

function normalizeHabit(item, logs, analyticsMap) {
  const analytics = analyticsMap.get(item._id) || {};
  const normalized = {
    id: item._id,
    title: item.name,
    repeat: item.repeat || "",
    time: item.time || "",
    date: item.scheduledDate || "",
    status: item.status || "pending",
    todayStatus: item.todayStatus || "pending",
    createdAt: item.createdAt,
    streak: analytics.streak || 0,
    completionRate: analytics.completionRate || 0,
  };

  return {
    ...normalized,
    visualStatus: getHabitVisualStatus(normalized, logs),
  };
}

function normalizeNote(item) {
  return {
    id: item._id,
    title: item.title,
    content: item.content,
    category: item.category || "general",
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
  };
}

function normalizeReminder(item) {
  const iso = item.scheduledFor;
  return {
    id: item._id,
    title: item.title,
    message: item.message || "",
    status: normalizeStatus(item.status),
    rawStatus: item.status,
    scheduledFor: iso,
    date: toLocalDateInputValue(iso),
    time: toLocalTimeInputValue(iso),
    updatedAt: item.updatedAt,
  };
}

function normalizeSchedule(item) {
  const scheduledFor = item.scheduledFor || `${item.date}T${item.time}:00`;
  return {
    id: item._id || item.id,
    title: item.title,
    category: item.category || "general",
    status: normalizeStatus(item.status || "scheduled"),
    rawStatus: item.status || "scheduled",
    scheduledFor,
    date: item.date || toLocalDateInputValue(scheduledFor),
    time: item.time || toLocalTimeInputValue(scheduledFor),
    updatedAt: item.updatedAt,
  };
}

function normalizeLog(item) {
  return {
    id: item._id || item.id,
    habitId: String(item.habitId?._id || item.habitId || ""),
    habitName: item.habitName || item.habitId?.name || "",
    date: item.date,
    status: item.status,
    source: item.source || "manual",
    createdAt: item.createdAt,
  };
}

function findByTitle(items, title) {
  const needle = (title || "").trim().toLowerCase();
  return items.find((item) => item.title.toLowerCase() === needle) || items.find((item) => item.title.toLowerCase().includes(needle));
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const token = localStorage.getItem(STORAGE_KEYS.token);

  if (options.auth !== false && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const config = {
    method: options.method || "GET",
    headers,
  };

  if (options.body !== undefined) {
    config.body = JSON.stringify(options.body);
  }

  debugLog("request", { path, method: config.method, body: options.body });

  const response = await fetch(`${resolveApiBase()}${path}`, config);
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  let data = null;

  if (text && isJson) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
    }

    if (!isJson) {
      const currentBase = resolveApiBase();
      const sameOriginApi = currentBase === "/api";
      const notFoundHint =
        response.status === 404 && sameOriginApi
          ? "The frontend is running, but the backend API is not available on this site. Open Connection settings and point VoxaHabit to your deployed backend URL."
          : `Request failed (${response.status})`;

      throw new Error(notFoundHint);
    }

    throw new Error(data?.message || `Request failed (${response.status})`);
  }

  debugLog("response", { path, data });
  return data;
}

window.voxaApi = {
  getApiBase() {
    return getApiBase();
  },
  setApiBase(value) {
    return setApiBase(value);
  },
  getToken() {
    return localStorage.getItem(STORAGE_KEYS.token) || "";
  },
  isAuthenticated() {
    return Boolean(this.getToken());
  },
  getCurrentUser() {
    return readJson(STORAGE_KEYS.user, null);
  },
  async register(email, password) {
    const payload = await request("/auth/register", {
      method: "POST",
      auth: false,
      body: { email, password },
    });
    setSession(payload.token, payload.user);
    return payload;
  },
  async login(email, password) {
    const payload = await request("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    });
    setSession(payload.token, payload.user);
    return payload;
  },
  logout() {
    clearSession();
  },
  async refreshSession() {
    const payload = await request("/auth/me");
    writeJson(STORAGE_KEYS.user, payload.user);
    return payload.user;
  },
  async refineVoiceCommand(text, baseCommand, options = {}) {
    const payload = await request("/ai/parse", {
      method: "POST",
      body: {
        text,
        baseCommand,
        allowIntentRefine: Boolean(options.allowIntentRefine),
      },
    });
    return payload.command || baseCommand;
  },
  async parseVoiceCommand(text) {
    const parser = window.voxaCommandParser || {};
    const quickParse =
      typeof parser.quickParse === "function"
        ? parser.quickParse.bind(parser)
        : typeof parser.parse === "function"
          ? parser.parse.bind(parser)
          : null;

    if (!quickParse) {
      throw new Error("Voice parser is still loading. Please refresh and try again.");
    }

    const baseCommand = await quickParse(text);
    const isCompound = /\s+(?:and then|then|and)\s+/i.test(text);
    debugLog("local quick parse", baseCommand);
    const preview = await request("/ai/parse", {
      method: "POST",
      body: {
        text,
        baseCommand: isCompound ? undefined : baseCommand,
        allowIntentRefine: isCompound
          ? true
          : typeof parser.shouldUseAiAssist === "function"
            ? parser.shouldUseAiAssist(baseCommand)
            : (baseCommand.confidence || 0) < 0.75,
      },
    });
    debugLog("voice preview", preview);
    return preview;
  },
  async getDashboardData() {
    const [userPayload, habitsPayload, notesPayload, remindersPayload, schedulesPayload, logsPayload, analyticsPayload, activityPayload, historyPayload] =
      await Promise.all([
        request("/auth/me"),
        request("/habits"),
        request("/notes"),
        request("/reminders"),
        request("/schedule"),
        request("/logs"),
        request("/logs/analytics"),
        request("/activity"),
        request("/history"),
      ]);

    writeJson(STORAGE_KEYS.user, userPayload.user);

    const logs = logsPayload.map(normalizeLog);
    const analyticsMap = new Map(
      (analyticsPayload.habits || []).map((habit) => [String(habit.habitId), habit])
    );
    const habits = habitsPayload.map((habit) => normalizeHabit(habit, logs, analyticsMap));
    const notes = notesPayload.map(normalizeNote);
    const reminders = remindersPayload.map(normalizeReminder);
    const schedules = schedulesPayload.map(normalizeSchedule);
    const activity = (activityPayload || []).map((item) => ({
      id: item.id,
      message: item.message,
      createdAt: item.createdAt,
      type: item.type,
      status: item.status || "pending",
    }));
    const history = (historyPayload || []).map(normalizeLog);

    return {
      user: userPayload.user,
      habits,
      notes,
      reminders,
      schedules,
      logs,
      activity,
      history,
      analytics: {
        totalHabits: analyticsPayload.overview?.totalHabits || habits.length,
        totalNotes: analyticsPayload.overview?.totalNotes || notes.length,
        totalReminders: analyticsPayload.overview?.totalReminders || reminders.length,
        totalSchedules: analyticsPayload.overview?.totalSchedules || schedules.length,
        completionRate: Math.round(analyticsPayload.overview?.overallCompletionRate || 0),
        streakLeader:
          [...habits].sort((left, right) => right.streak - left.streak)[0] || null,
      },
    };
  },
  async createHabit(payload) {
    const response = await request("/habits", {
      method: "POST",
      body: {
        name: payload.title.trim(),
        repeat: payload.repeat || "daily",
        time: payload.time || "",
        scheduledDate: payload.date || "",
      },
    });
    dispatchDataUpdated("habit:create");
    return response;
  },
  async deleteHabit(habitId) {
    const response = await request(`/habits/${habitId}`, { method: "DELETE" });
    dispatchDataUpdated("habit:delete");
    return response;
  },
  async markHabit(habitId, status) {
    const mappedStatus = status === "completed" ? "completed" : "skipped";
    const response = await request(`/habits/${habitId}/mark`, {
      method: "POST",
      body: { status: mappedStatus, source: "manual" },
    });
    dispatchDataUpdated("habit:mark");
    return response;
  },
  async saveNote(payload) {
    const body = {
      title: (payload.title || payload.content).trim(),
      content: payload.content.trim(),
      category: payload.category || "general",
    };
    const response = payload.id
      ? await request(`/notes/${payload.id}`, { method: "PATCH", body })
      : await request("/notes", { method: "POST", body });
    dispatchDataUpdated("note:save");
    return normalizeNote(response);
  },
  async deleteNote(noteId) {
    const response = await request(`/notes/${noteId}`, { method: "DELETE" });
    dispatchDataUpdated("note:delete");
    return response;
  },
  async saveReminder(payload) {
    const body = {
      title: payload.title.trim(),
      message: (payload.message || "").trim(),
      date: payload.date,
      time: payload.time || "",
    };
    const response = payload.id
      ? await request(`/reminders/${payload.id}`, { method: "PATCH", body })
      : await request("/reminders", { method: "POST", body });
    dispatchDataUpdated("reminder:save");
    return normalizeReminder(response);
  },
  async deleteReminder(reminderId) {
    const response = await request(`/reminders/${reminderId}`, { method: "DELETE" });
    dispatchDataUpdated("reminder:delete");
    return response;
  },
  async snoozeReminder(reminderId) {
    const response = await request(`/reminders/${reminderId}/snooze`, {
      method: "POST",
      body: { minutes: 10 },
    });
    dispatchDataUpdated("reminder:snooze");
    return normalizeReminder(response);
  },
  async completeReminder(reminderId) {
    const response = await request(`/reminders/${reminderId}/stop`, { method: "POST" });
    dispatchDataUpdated("reminder:complete");
    return normalizeReminder(response);
  },
  async saveSchedule(payload) {
    const body = {
      title: payload.title.trim(),
      category: payload.category || "general",
      date: payload.date,
      time: payload.time || "",
    };
    const response = payload.id
      ? await request(`/schedule/${payload.id}`, { method: "PATCH", body })
      : await request("/schedule", { method: "POST", body });
    dispatchDataUpdated("schedule:save");
    return normalizeSchedule(response);
  },
  async deleteSchedule(scheduleId) {
    const response = await request(`/schedule/${scheduleId}`, { method: "DELETE" });
    dispatchDataUpdated("schedule:delete");
    return response;
  },
  async executeVoiceCommand(command) {
    const payload = await request("/ai/execute", {
      method: "POST",
      body: {
        preview: command.previews ? undefined : command,
        previews: command.previews || undefined,
      },
    });
    debugLog("voice execution", payload);
    const executions = payload.executions || (payload.execution ? [payload.execution] : []);
    const primaryExecution = executions[0] || null;
    const latestUndoableExecution = [...executions].reverse().find((execution) => execution?.undoAvailable) || null;

    if (latestUndoableExecution?.undoAvailable) {
      setVoiceUndo({
        message: latestUndoableExecution.message,
        createdAt: new Date().toISOString(),
      });
    } else {
      clearVoiceUndo();
    }
    dispatchDataUpdated("voice:execute");
    await this.getDashboardData();
    return {
      message:
        executions.length > 1
          ? executions.map((execution) => execution.message).filter(Boolean).join(" ")
          : primaryExecution?.message || "Voice command executed.",
      executions,
      execution: primaryExecution,
      multiIntent: executions.length > 1,
    };
  },
  getVoiceUndo() {
    return getVoiceUndo();
  },
  clearVoiceUndo() {
    clearVoiceUndo();
  },
  async undoLastVoiceAction() {
    const payload = await request("/ai/undo", {
      method: "POST",
      body: {},
    });
    clearVoiceUndo();
    dispatchDataUpdated("voice:undo");
    await this.getDashboardData();
    return payload;
  },
  formatDateTime(date) {
    return formatDateTime(date);
  },
};
