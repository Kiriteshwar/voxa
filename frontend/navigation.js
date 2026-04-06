(function navigationModule() {
  const page = document.body.dataset.page;

  function redirectTo(path) {
    window.location.replace(path);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    });
  }

  function guardPage() {
    const authenticated = window.voxaApi.isAuthenticated();

    if (page === "login" && authenticated) {
      redirectTo("/pages/app.html");
      return false;
    }

    if ((page === "app" || page === "voice") && !authenticated) {
      redirectTo("/pages/login.html");
      return false;
    }

    return true;
  }

  function renderBadge(label, kind = "neutral") {
    return `<span class="inline-badge inline-badge--${kind}">${label}</span>`;
  }

  function renderListItem(title, meta, options = {}) {
    const classes = ["list-item"];
    if (options.statusClass) {
      classes.push(`list-item--${options.statusClass}`);
    }

    const actionButtons = options.actions?.length
      ? `<div class="list-actions">${options.actions
          .map(
            (action) =>
              `<button type="button" class="${action.kind || "secondary-action"}" data-action="${action.action}" data-id="${action.id}">${action.label}</button>`
          )
          .join("")}</div>`
      : "";

    return `
      <article class="${classes.join(" ")}">
        <h4>${title}</h4>
        <div class="list-meta">${meta}</div>
        ${actionButtons}
      </article>
    `;
  }

  function setupLoginPage() {
    const authForm = document.getElementById("authForm");
    const registerButton = document.getElementById("registerButton");
    const authMessage = document.getElementById("authMessage");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");

    async function submitAuth(mode) {
      const email = emailInput.value.trim();
      const password = passwordInput.value.trim();

      if (!email || !password) {
        authMessage.textContent = "Enter both email and password.";
        return;
      }

      try {
        authMessage.textContent = mode === "login" ? "Signing you in..." : "Creating account...";
        if (mode === "login") {
          await window.voxaApi.login(email, password);
        } else {
          await window.voxaApi.register(email, password);
        }
        redirectTo("/pages/app.html");
      } catch (error) {
        authMessage.textContent = error.message;
      }
    }

    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitAuth("login");
    });

    registerButton.addEventListener("click", async () => {
      await submitAuth("register");
    });
  }

  function setupAppPage() {
    const logoutButton = document.getElementById("logoutButton");
    const notificationButton = document.getElementById("notificationButton");
    const reminderMessageText = document.getElementById("reminderMessageText");
    const tabButtons = Array.from(document.querySelectorAll(".nav-item"));
    const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
    const userEmail = document.getElementById("userEmail");
    const recentActivity = document.getElementById("recentActivity");
    const habitCount = document.getElementById("habitCount");
    const noteCount = document.getElementById("noteCount");
    const reminderCount = document.getElementById("reminderCount");
    const habitList = document.getElementById("habitList");
    const noteList = document.getElementById("noteList");
    const reminderList = document.getElementById("reminderList");
    const analyticsGrid = document.getElementById("analyticsGrid");
    const upcomingList = document.getElementById("upcomingList");
    const historyList = document.getElementById("historyList");
    const undoSnackbar = document.getElementById("undoSnackbar");
    const undoMessage = document.getElementById("undoMessage");
    const undoButton = document.getElementById("undoButton");

    const habitForm = document.getElementById("habitForm");
    const noteForm = document.getElementById("noteForm");
    const reminderForm = document.getElementById("reminderForm");
    const clearNoteButton = document.getElementById("clearNoteButton");
    const clearReminderButton = document.getElementById("clearReminderButton");

    userEmail.textContent = window.voxaApi.getCurrentUser()?.email || "Guest";

    function setActiveTab(tabName) {
      tabButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.tab === tabName);
      });
      tabPanels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.tabPanel === tabName);
      });
    }

    function resetNoteForm() {
      noteForm.reset();
      document.getElementById("noteId").value = "";
      document.getElementById("noteCategory").value = "general";
    }

    function resetReminderForm() {
      reminderForm.reset();
      document.getElementById("reminderId").value = "";
    }

    async function showUndoSnackbarIfNeeded() {
      const undoPayload = window.voxaApi.getVoiceUndo();
      if (!undoPayload) {
        undoSnackbar.classList.add("hidden");
        return;
      }

      undoMessage.textContent = `${undoPayload.message} Undo?`;
      undoSnackbar.classList.remove("hidden");
    }

    function buildUpcomingItems(habits, reminders, schedules) {
      const habitItems = habits
        .filter((habit) => habit.time || habit.date)
        .map((habit) => ({
          title: `Habit: ${habit.title}`,
          when:
            habit.date && habit.time
              ? `${habit.date} ${habit.time}`
              : habit.date
                ? habit.date
                : `Next ${habit.repeat || "routine"} at ${habit.time}`,
        }));

      const reminderItems = reminders.map((reminder) => ({
        title: `Reminder: ${reminder.title}`,
        when: window.voxaApi.formatDateTime(reminder.scheduledFor),
      }));

      const scheduleItems = schedules.map((schedule) => ({
        title: `Schedule: ${schedule.title}`,
        when: window.voxaApi.formatDateTime(schedule.scheduledFor),
      }));

      return [...scheduleItems, ...reminderItems, ...habitItems].slice(0, 8);
    }

    async function renderApp() {
      console.debug("[VoxaUI] renderApp triggered");
      const data = await window.voxaApi.getDashboardData();
      userEmail.textContent = data.user?.email || "Guest";

      habitCount.textContent = String(data.habits.length);
      noteCount.textContent = String(data.notes.length);
      reminderCount.textContent = String(data.reminders.length + data.schedules.length);

      recentActivity.innerHTML = data.activity.length
        ? data.activity
            .map((item) =>
              renderListItem(item.message, new Date(item.createdAt).toLocaleString(), {
                statusClass: item.status || "pending",
              })
            )
            .join("")
        : '<div class="support-text">No activity yet. Start with voice or add your first item.</div>';

      habitList.innerHTML = data.habits.length
        ? data.habits
            .map((habit) =>
              renderListItem(
                habit.title,
                [
                  renderBadge(habit.visualStatus, habit.visualStatus),
                  habit.repeat ? renderBadge(habit.repeat, "neutral") : "",
                  habit.time ? renderBadge(habit.time, "neutral") : "",
                  habit.date ? renderBadge(habit.date, "neutral") : "",
                ]
                  .filter(Boolean)
                  .join(" "),
                {
                  statusClass: habit.visualStatus,
                  actions: [
                    { id: habit.id, action: "complete-habit", label: "Done", kind: "primary-action" },
                    { id: habit.id, action: "delete-habit", label: "Delete", kind: "secondary-action" },
                  ],
                }
              )
            )
            .join("")
        : '<div class="support-text">No habits yet.</div>';

      noteList.innerHTML = data.notes.length
        ? data.notes
            .map((note) =>
              renderListItem(
                note.title,
                `${renderBadge(note.category, "category")} ${note.content}`,
                {
                  statusClass: "neutral",
                  actions: [
                    { id: note.id, action: "edit-note", label: "Edit", kind: "secondary-action" },
                    { id: note.id, action: "delete-note", label: "Delete", kind: "secondary-action" },
                  ],
                }
              )
            )
            .join("")
        : '<div class="support-text">No notes yet.</div>';

      const reminderCards = data.reminders.map((reminder) =>
        renderListItem(
          reminder.title,
          [
            renderBadge(reminder.status, reminder.status === "completed" ? "completed" : "pending"),
            renderBadge(window.voxaApi.formatDateTime(reminder.scheduledFor), "neutral"),
          ].join(" "),
          {
            statusClass: reminder.status === "completed" ? "completed" : "pending",
            actions: [
              { id: reminder.id, action: "edit-reminder", label: "Edit", kind: "secondary-action" },
              { id: reminder.id, action: "delete-reminder", label: "Delete", kind: "secondary-action" },
            ],
          }
        )
      );

      const scheduleCards = data.schedules.map((schedule) =>
        renderListItem(
          schedule.title,
          [
            renderBadge("schedule", "category"),
            renderBadge(window.voxaApi.formatDateTime(schedule.scheduledFor), "neutral"),
          ].join(" "),
          {
            statusClass: "pending",
          }
        )
      );

      reminderList.innerHTML = [...reminderCards, ...scheduleCards].length
        ? [...reminderCards, ...scheduleCards].join("")
        : '<div class="support-text">No reminders or schedules yet.</div>';

      const analyticsItems = [
        { label: "Habits", value: data.analytics.totalHabits },
        { label: "Notes", value: data.analytics.totalNotes },
        { label: "Reminders", value: data.analytics.totalReminders },
        { label: "Schedules", value: data.analytics.totalSchedules },
        { label: "Completion", value: `${data.analytics.completionRate}%` },
        {
          label: "Top streak",
          value: data.analytics.streakLeader ? `${data.analytics.streakLeader.streak}d` : "0d",
        },
      ];

      analyticsGrid.innerHTML = analyticsItems
        .map(
          (item) => `
            <article class="analytics-stat">
              <span>${item.label}</span>
              <strong>${item.value}</strong>
            </article>
          `
        )
        .join("");

      const upcoming = buildUpcomingItems(data.habits, data.reminders, data.schedules);
      upcomingList.innerHTML = upcoming.length
        ? upcoming.map((item) => renderListItem(item.title, item.when)).join("")
        : '<div class="support-text">No upcoming items yet.</div>';

      historyList.innerHTML = data.history.length
        ? data.history
            .map((item) =>
              renderListItem(
                item.habitName || "Habit",
                [
                  renderBadge(item.status, item.status === "completed" ? "completed" : "missed"),
                  renderBadge(item.date, "neutral"),
                  renderBadge(item.source, "neutral"),
                ].join(" "),
                {
                  statusClass: item.status === "completed" ? "completed" : "missed",
                }
              )
            )
            .join("")
        : '<div class="support-text">No history yet.</div>';

      console.debug("[VoxaUI] renderApp complete", {
        habits: data.habits.length,
        notes: data.notes.length,
        reminders: data.reminders.length,
        schedules: data.schedules.length,
        activity: data.activity.length,
        history: data.history.length,
      });

      await showUndoSnackbarIfNeeded();
    }

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.tab));
    });

    logoutButton.addEventListener("click", () => {
      window.voxaApi.clearVoiceUndo();
      window.voxaApi.logout();
      redirectTo("/pages/login.html");
    });

    undoButton.addEventListener("click", async () => {
      try {
        const result = await window.voxaApi.undoLastVoiceAction();
        undoMessage.textContent = result.message;
        setTimeout(() => {
          undoSnackbar.classList.add("hidden");
        }, 1200);
        await renderApp();
      } catch (error) {
        undoMessage.textContent = error.message;
      }
    });

    notificationButton.addEventListener("click", async () => {
      if (!("Notification" in window)) {
        reminderMessageText.textContent = "Notifications are not supported in this browser.";
        return;
      }

      const result = await Notification.requestPermission();
      reminderMessageText.textContent = `Notification permission: ${result}`;
    });

    habitForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await window.voxaApi.createHabit({
        title: document.getElementById("habitName").value,
        repeat: document.getElementById("habitRepeat").value,
        date: document.getElementById("habitDate").value,
        time: document.getElementById("habitTime").value,
      });
      habitForm.reset();
      await renderApp();
    });

    noteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await window.voxaApi.saveNote({
        id: document.getElementById("noteId").value,
        title: document.getElementById("noteTitle").value,
        category: document.getElementById("noteCategory").value,
        content: document.getElementById("noteContent").value,
      });
      resetNoteForm();
      await renderApp();
    });

    reminderForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await window.voxaApi.saveReminder({
        id: document.getElementById("reminderId").value,
        title: document.getElementById("reminderTitle").value,
        message: document.getElementById("reminderMessage").value,
        date: document.getElementById("reminderDate").value,
        time: document.getElementById("reminderTime").value,
      });
      resetReminderForm();
      await renderApp();
    });

    clearNoteButton.addEventListener("click", resetNoteForm);
    clearReminderButton.addEventListener("click", resetReminderForm);

    noteList.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }

      const data = await window.voxaApi.getDashboardData();
      const note = data.notes.find((item) => item.id === button.dataset.id);
      if (!note) {
        return;
      }

      if (button.dataset.action === "edit-note") {
        document.getElementById("noteId").value = note.id;
        document.getElementById("noteTitle").value = note.title;
        document.getElementById("noteCategory").value = note.category;
        document.getElementById("noteContent").value = note.content;
        setActiveTab("notes");
        return;
      }

      await window.voxaApi.deleteNote(note.id);
      await renderApp();
    });

    reminderList.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }

      const data = await window.voxaApi.getDashboardData();
      const reminder = data.reminders.find((item) => item.id === button.dataset.id);
      if (!reminder) {
        return;
      }

      if (button.dataset.action === "edit-reminder") {
        document.getElementById("reminderId").value = reminder.id;
        document.getElementById("reminderTitle").value = reminder.title;
        document.getElementById("reminderMessage").value = reminder.message;
        document.getElementById("reminderDate").value = reminder.date;
        document.getElementById("reminderTime").value = reminder.time;
        setActiveTab("reminders");
        return;
      }

      await window.voxaApi.deleteReminder(reminder.id);
      await renderApp();
    });

    habitList.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }

      if (button.dataset.action === "complete-habit") {
        await window.voxaApi.markHabit(button.dataset.id, "completed");
      }

      if (button.dataset.action === "delete-habit") {
        await window.voxaApi.deleteHabit(button.dataset.id);
      }

      await renderApp();
    });

    setActiveTab("voice");
    renderApp().catch((error) => {
      reminderMessageText.textContent = error.message;
      if (!window.voxaApi.isAuthenticated()) {
        redirectTo("/pages/login.html");
      }
    });
  }

  registerServiceWorker();

  if (!guardPage()) {
    return;
  }

  if (page === "login") {
    setupLoginPage();
  }

  if (page === "app") {
    setupAppPage();
  }
})();
