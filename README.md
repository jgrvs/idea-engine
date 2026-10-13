# Idea Engine

A self-hosted, Claude-powered pipeline that takes entrepreneurial ideas from generation
to a small piece of working software, one gated stage at a time. Runs as a single
long-lived local process — portable across Windows and Linux (macOS works too).

**What and why:** Brainstorming with an LLM is easy; getting a *useful, non-repetitive,
ranked* stream of ideas out of one is not. Left alone, a model keeps proposing variations
of the same few concepts, and a flat "rate this 1-10" prompt gives scores you can't tune.
Idea Engine wraps Claude in a small pipeline that filters near-duplicates by meaning and
scores each idea on several sub-dimensions you can re-weight after the fact. From there
an idea only moves forward through gates, and each stage produces something small and
reviewable before the next, more expensive one is paid for: a one-page spec, then a
clickable mock, then evidence against its assumptions, and only then real code for a
single feature.

<!-- TODO: add dashboard screenshot or GIF here, e.g. ![Dashboard](docs/dashboard.png) -->

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- SQLite via `better-sqlite3` (`data/ideas.db`)
- `node-cron` for the 3 AM generate / 11 PM slice-build jobs (in-process — OS-agnostic)
- Anthropic SDK: `claude-sonnet-4-6` for generation, analysis, spec, and mock; `claude-opus-5-5`
  for the slice agent (both set in `lib/llm.ts`)
- `@huggingface/transformers` running `all-MiniLM-L6-v2` locally for embeddings

## Design decisions

- **Meaning-based dedup with local embeddings.** Exact-title matching misses reworded
  repeats. Each idea is embedded (384-dim, stored as a BLOB in SQLite), and a new
  candidate is dropped if its cosine similarity to any stored idea *or* any earlier
  candidate in the same batch meets a threshold. The model runs in-process, so dedup
  costs no API calls and needs no key.
- **Viability scoring computed outside the model.** Claude returns five anchored 1-10
  sub-scores (technical, deployment, market barrier, demand, market size). The composite
  is calculated in code as market value × attainability^gate, with a tunable
  market-size target. Changing weights re-ranks the whole library instantly, with no
  regeneration and no extra tokens.
- **In-process cron instead of an OS scheduler.** `node-cron` inside the app keeps one
  deployable unit that behaves the same on Windows, Linux, and macOS, with PM2 for
  restarts. The trade-off is that jobs only fire while the host is awake (see
  [A note on sleep](#a-note-on-sleep)).
- **SQLite for storage.** Single user, single process, small data: a file database
  avoids running a server, makes backup a file copy, and keeps the project self-hosted.
  Embeddings live next to the rows they describe.
- **An explicit state machine with a decision log.** Every status change goes through
  one `transition()` function backed by a table of allowed moves (`lib/stages.ts`). A gate
  is enforced by the move simply not existing: nothing can reach a build except from the
  validation stage. Each move records who made it and why, and a kill always needs a
  reason.
- **Small artifacts before big ones.** Each stage costs several times the one before it,
  so each one has to earn the next. A spec is a few cents, a mock under a dime, and a
  slice a dollar or two; most ideas should die before the expensive end.
- **One feature, from a pinned template, behind a real build.** The slice stage does not
  ask a model for a whole app. It scaffolds a known-good project, lets an agent implement
  only the spec's first feature with a handful of file tools, and then runs the build and
  a smoke test itself. A red build is a failed slice, with the log attached.

## Pipeline

| Stage | Produces | Gate |
|---|---|---|
| Generate (3 AM) | Ideas with five sub-scores | Automatic: low viability is parked under Screened |
| Triage | Keep or kill | You. A kill needs a reason |
| Analyze | Analyst report, VC critique, one reconciled verdict | You |
| Spec | One page: persona, wedge feature, three-item scope, success and kill criteria, assumptions | You approve, edit, or redraft |
| Mock | A clickable single-file HTML mock of the wedge workflow | You advance, iterate with feedback, or kill |
| Validate | One experiment per assumption, plus an optional landing page for demand testing | At least one assumption confirmed, or an override with a written reason |
| Slice (on demand, or 11 PM) | The spec's first feature as running code | Automatic: build passes and the home page responds. Then you run it and mark it works or broken |

Mocks and slices are written under the directory in `SANDBOX_PATH`, one folder per idea.

### What the slice stage runs on your machine

Building a slice installs the template's pinned dependencies, then builds and briefly
starts code that a model wrote. That code runs as you, with your filesystem access. The
engine limits what it can: the agent cannot change dependencies or build config or write
outside the slice folder, the build and server get a stripped environment with no API
key in it, and the smoke-test server listens on 127.0.0.1 only. It is still not a
sandbox. Review a slice before running it anywhere that matters.

## Setup (any OS)

```bash
npm install          # rebuilds the better-sqlite3 native module for THIS machine
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY and SANDBOX_PATH
```

Then open **Settings → Generation** in the dashboard to set your founder profile, the
domains the scheduler rotates through, and your sector preferences. These live in the
local SQLite config table (git-ignored), not in the codebase, so the repo stays generic.

> **Moving between machines/OSes:** `better-sqlite3` is a native module. Always run
> `npm install` on each host (don't copy `node_modules` between Windows and Linux).
> On a fresh Linux box you may need build tools first: `sudo apt-get install -y build-essential python3`.

## Develop

```bash
npm run dev          # http://localhost:3000
```

## Run it indefinitely (production, cross-platform)

Build once, then run under [PM2](https://pm2.keymetrics.io/) — a process manager that
auto-restarts on crash and relaunches on reboot. Same commands on Windows and Linux.

```bash
npm install -g pm2
npm run build
pm2 start ecosystem.config.js
pm2 save              # snapshot the process list for reboot recovery
```

**Make it start on boot:**

- **Linux / macOS:** `pm2 startup` — then run the command it prints (sets up a systemd/launchd unit).
- **Windows:** `pm2 startup` isn't supported. Install the helper instead:
  ```powershell
  npm install -g pm2-windows-startup
  pm2-startup install
  pm2 save
  ```

**Manage:**

```bash
pm2 status            # see it running
pm2 logs idea-engine  # tail logs
pm2 restart idea-engine
pm2 stop idea-engine
```

After `pm2 save` + the startup hook, the app — and its 3 AM / 11 PM cron jobs — come
back automatically after any reboot.

## A note on sleep

The cron jobs only fire while the host is awake. On an always-on home server this is
a non-issue. On a laptop that sleeps overnight, either keep it awake (power settings)
or trigger the jobs from the OS scheduler with wake-from-sleep:

- **Windows:** Task Scheduler task hitting `POST /api/generate` (and `POST /api/ideas/<id>/slice`),
  with "Wake the computer to run this task" enabled.
- **Linux:** a systemd timer with `WakeSystem=true`, or a cron job (server stays awake anyway).

## Data & backups

- `data/ideas.db` — all ideas, analyses, specs, mocks, experiments, decisions, usage log, and
  config. Back this up.
- Mock HTML files and slice projects live under `SANDBOX_PATH`.
- Both are git-ignored.
