# Game Topic Radar

A personal, non-commercial research tool (a local Node.js app) that helps a single
content creator discover under-covered video-game history and trivia topics for
content planning.

Given a specific game, it reads **public** attention signals across platforms —
YouTube view counts via the YouTube Data API, plus Niconico — to surface topics that
real audiences genuinely watch and discuss, but that have not yet been covered for a
Chinese-speaking audience.

## What it does

- Reads **public** video metadata only: titles, view counts, channel names, publish dates.
- Helps the operator decide which game-history topics are worth making a video about.

## What it does NOT do

- It is **read-only**: it never posts, comments, votes, rates, or modifies anything on YouTube.
- It never accesses private user data.
- It does **not** bulk-export, resell, redistribute, or use any data to train machine-learning models.
- It has **no end users** other than its single operator — no login, no accounts, no cookies.

## Access

The source code is public here, but the tool itself is **not a hosted or publicly
accessible service** — it runs locally on the operator's own machine, at low request
volume.

## Privacy & terms

See [PRIVACY.md](PRIVACY.md). Use of YouTube API Services is subject to the
[YouTube Terms of Service](https://www.youtube.com/t/terms) and the
[Google Privacy Policy](https://policies.google.com/privacy).
