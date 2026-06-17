# 💪🏻 Workout App

A web application for workout tracking, built with pure HTML, CSS, and vanilla JavaScript on the front-end, plus a small Express/TypeScript proxy that fetches exercise demonstration GIFs.

## Features

### Profile
On first launch the home screen shows a **Create Profile** prompt. Set up your name and optionally upload a profile photo. Once created, the home screen becomes a personal dashboard:

- Your name
- Four live stats: **Check-ins · Days active · Duration · Calories** — all calculated from real logged data
- A monthly calendar where every workout day shows your photo as a small circle

Tap **Edit** (top-right) to update your name or photo at any time. **Log out** removes the profile from `localStorage`.

### Check-in
Log a workout for today directly from the home screen:

1. Tap the **Check-in** card
2. A bottom sheet opens — enter your **Duration (minutes)** and **Calories (kcal)**
3. Tap **Save**

The card turns green with ✅ once you've checked in for the day. Your photo immediately appears on that day in the home calendar. The four stats update in real time as sessions accumulate.

### Ready Workout
Access a library of **33 real pre-defined workouts**, organized by modality. Filter by workout type (Weight Training, Core, Cardio, etc.) and start any workout with a single tap.

### Build Workout
Automatic personalized workout generation. Configure four options and the app builds a workout at random:

- **Modalities** — pick one or more (Weight Training, Core, Cardio, Metabolic, Functional, Crossfit)
- **Duration** — 30 min or 45 min
- **Blocks** — 3 / 4 / 5 / 6 / 7 / 8 blocks
- **Sets** — 2 / 3 / 4 sets per block

If Weight Training is selected, an optional muscle-group filter lets you narrow exercises to a specific area (legs, chest, back, etc.).

### Calendar
Full calendar view showing all months with logged sessions. Tap any day to edit or delete that session (title, calories). Monthly totals visible at a glance. All data saved locally in `localStorage`.

### During the Workout
- Mark completed sets per block
- Edit the weight used for each exercise
- Workout progress bar
- Visual indicator when all blocks are complete
- Inline **"Show execution"** toggle on every non-cardio exercise that reveals an animated demonstration GIF

### Exercise Demonstration GIFs
Each exercise (except cardio) shows an animated GIF demonstrating proper form. GIFs are sourced from [fitnessprogramer.com](https://fitnessprogramer.com) — a public library with 1,200+ exercises — and served directly from their CDN. The API server:
- Translates Portuguese exercise names to English
- Fuzzy-matches each exercise against the fitnessprogramer.com exercise catalogue (1,234 entries from their sitemap)
- Caches every resolution to disk so lookups are instant and require no external calls at runtime
- Supports manual override or custom URL per exercise via the "Legitimize GIFs" screen

### Legitimize GIFs (manual override screen)
Because no public exercise database perfectly maps to Brazilian cross-training nomenclature, a dedicated "Legitimize GIFs" screen on the home menu lets you verify and manually fix every exercise:
- Lists all non-cardio exercises with their current GIF preview, matched name, and status badge
- Filter chips: All / No match / Auto / Manual / URL — plus a progress bar
- Inline candidate picker with mini GIFs (search by any English keyword to refine)
- **Custom URL field**: paste any public link to a `.gif` / `.jpg` / `.png` (Tenor, Giphy, Imgur, Instagram CDN, etc.) and the app will use that image instead

All overrides and custom URLs persist in JSON files on disk, so the work is done once and kept forever.

### Language Toggle
Switch between **Portuguese (PT)** and **English (EN)** at any time using the toggle button available on every screen. Language preference is saved between sessions.

## Available Modalities
| Modality | Description |
|---|---|
| 💪🏻 Weight Training | Free weights, machines and cables |
| 🎯 Core | Abs, planks and stability work |
| 🏃🏻 Cardio | Run, elliptical, bike |
| 🔥 Metabolic | High-intensity exercises and locomotion |
| ⚡ Functional | Compound and functional movements |
| 🏋🏻 Crossfit | Olympic lifts and gymnastic movements |
| ⚖️ Balance | Stability and proprioception work |

## Tech Stack

**Front-end** (`artifacts/workout/`)
- HTML5 + CSS3 + JavaScript (vanilla, single file)
- No frameworks or external libraries
- Persistent local data via `localStorage`
- Responsive design, optimized for mobile

**Back-end** (`artifacts/api-server/`)
- Node.js + Express 5 + TypeScript
- Resolves exercise GIFs from fitnessprogramer.com (no API key required)
- Disk-based JSON cache for exercise mapping and custom URL overrides
- WorkoutX API integration available as optional secondary source

**Repository layout**
- `pnpm` workspace monorepo
- `artifacts/workout/` — the web app itself
- `artifacts/api-server/` — the GIF proxy and override API
- `artifacts/api-server/data/` — persistent cache, overrides, custom URLs and PT→EN translations

## Data Storage

All user data lives in the browser — no account server needed.

| `localStorage` key | Contents |
|---|---|
| `wk_profile` | `{ name, photo (base64) }` |
| `wk_ci` | `{ [YYYY-MM-DD]: { title, calories, duration } }` |
| `wk_lang` | `"pt"` or `"en"` |

## Running Locally

Requirements: Node.js 24, pnpm.

```bash
pnpm install
pnpm --filter @workspace/api-server run dev   # API server
pnpm --filter @workspace/workout run dev      # web app
```

The web app is served on its own port and talks to the API server through `/api/exercise-media/*`.

### Environment variables
- `WORKOUTX_API_KEY` — optional. Used only if you want WorkoutX as a fallback source for exercises not found on fitnessprogramer.com.

## API Endpoints (back-end)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/exercise-media?name=<pt-name>` | Resolve a Portuguese exercise name to an exercise + GIF URL |
| `GET`  | `/api/exercise-media/candidates?q=<keyword>` | List candidate WorkoutX exercises for an English keyword |
| `POST` | `/api/exercise-media/override` | Pick a different WorkoutX exercise ID for a given name |
| `POST` | `/api/exercise-media/custom-url` | Set or clear a custom external image URL for a given name |
| `GET`  | `/api/exercise-media/gif/:id` | Stream a GIF file (adds the WorkoutX auth header) |
| `GET`  | `/api/exercise-media/_status` | Quick health check (key configured, cache size, override count) |

---

> **A note on the development process**
>
> This project was built using AI-powered tools — specifically **Claude (Anthropic)** and **Replit Agent** — as part of a modern approach to software development.
>
> The idea, feature structure, workout data, and all product decisions are entirely my own. The AI tools were used to accelerate technical implementation, debug issues, and iterate quickly on design and app behavior.
>
> To me, this way of working demonstrates two things: the ability to **think like a developer** — knowing what to build, how to structure it, what to fix, and how to evolve a product — and the skill to **use LLMs effectively**, leveraging their capabilities without losing control of the final result.
>
> Knowing how to use these tools intelligently is, increasingly, a technical skill in its own right.

---
