# VoxaHabit

VoxaHabit is a voice-first habit tracking PWA with authentication, cloud sync via MongoDB Atlas, analytics, reminders, and Gemini-powered natural language command parsing.

## Stack

- Frontend: HTML, CSS, JavaScript, PWA
- Backend: Node.js, Express.js
- Database: MongoDB Atlas with Mongoose
- AI: Gemini API
- Auth: JWT

## Project Structure

```text
frontend/
  index.html
  style.css
  app.js
  voice.js
  ai.js
  api.js
  manifest.json
  service-worker.js
backend/
  server.js
  models/
  routes/
  controllers/
  middleware/
```

## Quick Start

1. Install backend dependencies:

```bash
cd backend
npm install
```

2. Copy `.env.example` to `.env` inside `backend/` and fill in the values.

3. Start the API:

```bash
cd backend
npm run dev
```

4. Open `http://localhost:4000`.

## Environment Variables

See `backend/.env.example`.

## Current Scope

- Email/password authentication
- Habit CRUD
- Daily completion and skip logs
- Analytics dashboard data
- Voice input with browser speech recognition
- Gemini command parsing hook
- PWA manifest and service worker

## Notes

- Push notifications and true background alarms still require a production push service and permission flow.
- Real-time sync is implemented as cloud persistence plus client refresh hooks, not websockets.
