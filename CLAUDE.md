# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Server

Start the local development server:
```bash
python -m http.server 5500 --directory health-tracker
```

Then open `http://localhost:5500` in a browser. No build step or package installation required.

## Project Overview

**Health Recovery Tracker** — a single-page app for patients recovering from stress fractures. Tracks calcium intake, symptoms, medications, appointments, and medical records.

Stack: Vanilla JavaScript, Tailwind CSS (CDN), Chart.js (CDN), localStorage for persistence. No framework, no build tooling, no backend.

## Architecture

Two files contain the entire application:

- [health-tracker/index.html](health-tracker/index.html) — all markup and layout (~1,600 lines). Contains the sidebar nav, bottom mobile nav, all page containers, and modal templates.
- [health-tracker/app.js](health-tracker/app.js) — all application logic (~1,160 lines).

### app.js Structure

- **`DB`** — localStorage wrapper. All keys use `ht_` prefix. Stores entries as JSON arrays; each entry has `id` (timestamp + random) and `createdAt`.
- **`App`** — router and global state. `App.navigate(pageName)` drives all page transitions by toggling visibility on `[data-page]` containers.
- **Page objects** (`DashboardPage`, `CalciumPage`, `SymptomsPage`, `MedicalPage`, `MedsPage`, `ApptsPage`, `ArticlesPage`) — each has `init()` called on navigation and manages its own DOM mutations and event listeners.
- **USDA FDC API** integration in `CalciumPage` for food calcium lookup (uses a demo API key).
- Appointment reminders use the browser Notifications API, scheduled on app startup.

### Navigation Pattern

HTML elements with `[data-page="<name>"]` map to page objects. `App.navigate()` hides all pages then shows the target. The `.nav-btn[data-page]` buttons in the sidebar and bottom nav trigger navigation.

### UI Conventions

- Tailwind CSS utility classes exclusively (no custom CSS file).
- Indigo/purple primary theme; emerald = good, amber = moderate, red = critical.
- Modals are shown/hidden by toggling `hidden` class; forms submit on Enter key, close on Escape.
- Toast notifications via a `showToast(message, type)` utility.
- Charts rendered with Chart.js into `<canvas>` elements; re-initialized on each page visit.
