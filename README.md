# Completed Organizer

An Obsidian plugin that keeps a folder of finished notes — `06 - Completed` by default — filed into subfolders named for the year.

```
06 - Completed/
├── 2023/
│   └── 2023-11-02 -- Wrote the thing.md
├── 2024/
│   ├── 2024-03-01 -- Ship it.md
│   ├── 2024-08-19 -- Conference talk.md
│   └── 2024-05-02 -- Berlin trip/    ← dated folders get filed too
│       ├── notes.md
│       └── photos/
└── Undated/                          ← everything with no date lands here
    ├── Some note with no date.md
    └── Reference/
```

## How a note gets a year

The plugin looks for a `yyyy-mm-dd` at the *start* of, in order:

1. the **file name** — `2024-03-01 -- Ship it.md`
2. the **front matter** — a `title` key, then `date`, `created`, `completed`, `completed-on`, `day` (configurable)
3. the **title** — the first `# ` heading in the note

The date has to lead the string, and it has to be a real calendar date, so `2024-02-31 -- ...` and `Notes from 2024-03-01` are both ignored. Nothing gets guessed at, renamed, or edited — the plugin only ever moves things.

Moves go through Obsidian's own file manager, so links and backlinks to the note follow it.

## Undated things

Anything with no date — note or folder — goes into `06 - Completed/Undated/`, a sibling of the year folders. Rename it later, or give it a date in front matter, and the next sweep moves it out to the right year.

Two consequences worth knowing:

- An undated note sitting in `2024/` is collected into `Undated/` too. Being in a year folder is not by itself evidence of a date.
- Undated *folders* move whole, contents and all, exactly like dated ones.

Turn off **Collect undated items** to go back to leaving undated things exactly where they are.

The undated folder is a destination, like the year folders: it's never moved itself, and its contents are re-checked on every sweep. A folder that differs only in case (`undated` vs `Undated`) is treated as the same folder rather than a second one.

Automatic organizing on create/rename deliberately does **not** collect undated items — a new note has no date the moment you make it, and filing it away mid-keystroke would fight you. Sweeps pick them up.

## Folders

Subfolders are filed by the same rule, from the folder name — a folder has no front matter or heading to fall back on. `06 - Completed/2024-05-02 -- Berlin trip/` moves to `06 - Completed/2024/2024-05-02 -- Berlin trip/`.

A dated folder moves **whole**. The plugin does not look inside it, so a `2019-01-01 -- old receipt.md` sitting in a `2024-05-02 -- Berlin trip` folder stays in that folder rather than being pulled out to `2019/` — the folder groups those notes on purpose. That holds even with **Descend into non-year subfolders** turned on.

Year folders like `2024/` are the destinations and are never moved. An existing folder of the same name in the year folder is never merged into; the incoming one gets a numbered sibling (or is skipped, per the conflict setting).

Turn this off with **Organize folders too** if you only want loose notes filed.

## What it touches

By default the plugin considers:

- notes and dated folders sitting loose in `06 - Completed`
- notes and dated folders already inside a year folder like `06 - Completed/2024` — so a 2023 note or folder that ended up in `2024/` gets corrected

With **Collect undated items** on, every other subfolder gets filed too — a dated one into its year, an undated one into `Undated/` — always whole, so **Descend into non-year subfolders** has nothing left to descend into. Turn collecting off and that setting matters again: an undated folder like `06 - Completed/Reference` then stays put, and the setting decides whether the plugin reaches inside it.

Missing year folders are created as needed.

## Usage

- **Ribbon icon** (calendar) — sweep the folder.
- **Command: Organize completed notes into year folders** — same thing.
- **Command: Preview which notes would move (dry run)** — shows a report and changes nothing. Run this first.
- **Command: Organize the current note into its year folder** — just the active note.
- **Command: Send the current note to the completed folder** — see below.
- **Right-click anything → Send to completed folder** — files it, wherever it is in the vault.
- **Right-click any folder → Organize by year** — treat that folder as the root for one run.

By default it also files notes automatically as you create or rename them inside the folder. Turn that off under **Organize automatically** if you'd rather do it by hand.

### Sending something to the completed folder

Right-click a note or folder anywhere in the file explorer — or use the command on the active note — and it goes straight into `06 - Completed/<year>/`, in one move, by the same date rules as a sweep. Select several files first and the menu item files the lot.

Because you picked the item by hand, this ignores the settings that decide what a *sweep* is willing to touch: **Markdown only**, **Organize folders too**, and **Descend into non-year subfolders** don't apply, so a PDF or an undated folder goes where you point it. What it won't do is move the completed folder itself, any folder that contains it, or the year and undated folders inside it — those are destinations.

A note with no date lands in `Undated/` as usual, or in the root of the completed folder if **Collect undated items** is off. Nothing is renamed or edited, so if you want a note filed under a particular year, give it a `yyyy-mm-dd` first — in the file name or in front matter — and then send it.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Folder to organize | `06 - Completed` | Vault-relative path |
| File name / Front matter / Title | all on | Which sources to read a date from |
| Front matter keys | `date, created, completed, completed-on, day` | Checked in order |
| Organize folders too | on | File dated subfolders, whole |
| Collect undated items | on | Sweep dateless notes and folders into one folder |
| Undated folder name | `Undated` | A sibling of the year folders |
| Organize automatically | on | On create and rename inside the folder |
| Organize on startup | off | One sweep after the vault loads |
| Dry run | off | Report only, never move |
| Name conflicts | add a numeric suffix | Or leave the note where it is |
| Markdown only | on | Ignore attachments |
| Descend into non-year subfolders | off | On flattens every subfolder into year folders |
| Show ribbon icon | on | Needs a plugin reload |

## Installing with BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then **Add beta plugin** and paste this repository's URL.

## Building

```sh
npm install
npm run build   # type-check, then bundle to main.js
npm run dev     # watch mode
npm test        # type-check, then run the date-parsing tests
```

Needs Node 22.18 or newer — the tests are TypeScript run directly by `node --test`.

## Releasing

BRAT reads `main.js` and `manifest.json` from a release's *assets*, so a release has to exist before BRAT can install anything. `bin/release.sh` does the whole thing locally: bump, commit, tag, push, create the release, upload the assets.

```sh
export GITHUB_TOKEN=ghp_...        # repo scope, or Contents: read and write
bin/release.sh --dry-run           # say what it would do, change nothing
bin/release.sh --no-bump           # release the version already in manifest.json
bin/release.sh                     # bump the patch version and release that
bin/release.sh --minor             # or --major, or an explicit 1.2.3
```

CI only builds and tests; it does not cut releases.

## License

MIT
