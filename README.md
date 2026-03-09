# Learn TTPs

> **MITRE ATT&CK flashcards — spaced repetition for the modern defender.**

Adversary TTPs don't stand still. MITRE ATT&CK is updated twice a year, new sub-techniques appear, tactics get re-categorised, and defenders who haven't kept up quietly fall behind. **Learn TTPs** is a static-site flashcard app that turns the entire ATT&CK knowledge base into a spaced-repetition study deck — no account, no server, no install.

---

## Why it exists

Reading a technique description once doesn't mean you'll recognise it in the wild. Spaced repetition forces you back to a card right before your brain would have forgotten it — a few weeks of daily reviews and detection names like *T1059.001 – PowerShell* or *T1078 – Valid Accounts* stop being trivia and start becoming reflexes.

The MITRE ATT&CK framework is standard vocabulary for red teams, blue teams, threat intel analysts, and SOC triage. Knowing it fluently means faster ticket writing, sharper threat models, and better conversations with every team you work with.

---

## Features

- **Anki-style SM-2 algorithm** — cards are scheduled based on how well you know them; easy cards resurface less often, hard cards more often.
- **Two decks** — *Techniques* (grouped by tactic) and *Mitigations* (countermeasures and defensive controls).
- **Session stats** — see your again / hard / good / easy split per session.
- **Persistent progress** — state is stored in IndexedDB (localStorage as fallback); clears only when you reset.
- **Fully offline** — no CDN fonts, no external requests. Open `index.html` and study.
- **Configurable new-cards-per-session** cap.

---

## Data

Flashcard content is sourced directly from the MITRE ATT&CK dataset:

| File | Contents |
|------|----------|
| `techniques.csv` | Enterprise ATT&CK techniques and sub-techniques (ID, name, description, tactics, platforms) |
| `mitigations.csv` | ATT&CK mitigations (ID, name, description) |

Both files can be refreshed from the official MITRE ATT&CK GitHub release when a new version ships.

---

## Usage

```bash
# Clone and open — that's it
git clone https://github.com/0xhmza/learn-ttps.git
cd learn-ttps
# Open index.html in your browser
```

Or visit the live version at **[0xhmza.github.io/learn-ttps](https://0xhmza.github.io/learn-ttps)** *(if hosted).*

---

## Project structure

```
.
├── index.html          # App shell and all views
├── style.css           # Single-file stylesheet
├── app.js              # SM-2 engine, CSV parser, routing
├── techniques.csv      # ATT&CK techniques dataset
├── mitigations.csv     # ATT&CK mitigations dataset
└── data/               # Optional extended data
```

---

## How the scheduler works

Cards cycle through three states: **New → Learning → Review**.

| Rating | Meaning | Effect |
|--------|---------|--------|
| Again | Forgot completely | Reset to Learning; interval → 1 day |
| Hard | Remembered with effort | Interval × 1.2 |
| Good | Normal recall | Interval × ease factor (starts at 2.5) |
| Easy | Instant recall | Interval × ease × 1.3; ease factor +0.15 |

Ease factor decreases on *Hard* and *Again*, preventing easy cards from dominating your queue.

---

## License

MIT — do whatever you want with it, just don't claim you wrote the ATT&CK data.

