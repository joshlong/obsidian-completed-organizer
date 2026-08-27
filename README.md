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
└── Some note with no date.md         ← left exactly where it is
```

## How a note gets a year

The plugin looks for a `yyyy-mm-dd` at the *start* of, in order:

1. the **file name** — `2024-03-01 -- Ship it.md`
2. the **front matter** — a `title` key, then `date`, `created`, `completed`, `completed-on`, `day` (configurable)
3. the **title** — the first `# ` heading in the note

The date has to lead the string, and it has to be a real calendar date, so `2024-02-31 -- ...` and `Notes from 2024-03-01` are both ignored. **If no date is found, the note is left alone.** Nothing gets guessed at, renamed, or edited — the plugin only ever moves files.

Moves go through Obsidian's own file manager, so links and backlinks to the note follow it.

## Folders

Subfolders are filed by the same rule, from the folder name — a folder has no front matter or heading to fall back on. `06 - Completed/2024-05-02 -- Berlin trip/` moves to `06 - Completed/2024/2024-05-02 -- Berlin trip/`.

A dated folder moves **whole**. The plugin does not look inside it, so a `2019-01-01 -- old receipt.md` sitting in a `2024-05-02 -- Berlin trip` folder stays in that folder rather than being pulled out to `2019/` — the folder groups those notes on purpose. That holds even with **Descend into non-year subfolders** turned on.

Year folders like `2024/` are the destinations and are never moved. An existing folder of the same name in the year folder is never merged into; the incoming one gets a numbered sibling (or is skipped, per the conflict setting).

Turn this off with **Organize folders too** if you only want loose notes filed.

## What it touches

By default the plugin considers:

- notes and dated folders sitting loose in `06 - Completed`
- notes and dated folders already inside a year folder like `06 - Completed/2024` — so a 2023 note or folder that ended up in `2024/` gets corrected

The *contents* of any other subfolder you made by hand (`06 - Completed/Reference`, say) are left alone, unless you turn on **Descend into non-year subfolders** in settings.

Missing year folders are created as needed.

## Usage

- **Ribbon icon** (calendar) — sweep the folder.
- **Command: Organize completed notes into year folders** — same thing.
- **Command: Preview which notes would move (dry run)** — shows a report and changes nothing. Run this first.
- **Command: Organize the current note into its year folder** — just the active note.
- **Right-click any folder → Organize by year** — treat that folder as the root for one run.

By default it also files notes automatically as you create or rename them inside the folder. Turn that off under **Organize automatically** if you'd rather do it by hand.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Folder to organize | `06 - Completed` | Vault-relative path |
| File name / Front matter / Title | all on | Which sources to read a date from |
| Front matter keys | `date, created, completed, completed-on, day` | Checked in order |
| Organize folders too | on | File dated subfolders, whole |
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
