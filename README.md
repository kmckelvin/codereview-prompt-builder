# codereview-commenter

A local code-review tool for GitLab merge requests, GitHub pull requests /
compare ranges, and local git branches. Fetches the diff (via the `glab` or
`gh` CLI, or `git`), opens a browser UI with a file tree and a
syntax-highlighted diff viewer, lets you attach comments to lines
(GitHub-style click or drag on the line-number gutter), and builds an LLM
prompt from your comments.

## Requirements

- [`glab`](https://gitlab.com/gitlab-org/cli) authenticated (`glab auth login`) — for GitLab MRs
- [`gh`](https://cli.github.com) authenticated (`gh auth login`) — for GitHub PRs/compares
- Node 20+

## Usage

```sh
npm install   # first time only

# Start screen: pick a URL, local repo + branches, or a recent review in the browser
npm start

# GitLab MR mode
npm start -- https://gitlab.com/group/repo/-/merge_requests/123

# GitHub PR or compare mode
npm start -- https://github.com/owner/repo/pull/123
npm start -- https://github.com/owner/repo/compare/main...my-branch

# Local repo mode — explicit range (passed to git verbatim)
npm start -- /path/to/repo master..my-branch

# Local repo mode — flags (compared via merge-base, like an MR)
npm start -- /path/to/repo --base master --head my-branch

# Local repo mode — defaults: --head is the currently checked-out branch,
# --base is the repo default branch (origin/HEAD, else main/master)
npm start -- /path/to/repo
```

The browser opens automatically. With no arguments you land on a start screen
where you can paste a URL, point at a local repo (typed path or native folder
picker, with branch pickers), or reopen one of the last 15 reviews; the `←`
button in the review toolbar takes you back to it. Then:

- **File tree** highlights the file currently at the top of the viewport and
  scrolls to keep it visible; file headers stay pinned while their diff is on
  screen.

- **File tree** (left) — click a file to jump to it; badges show comment counts.
- **Unified / Split** toggle in the toolbar.
- **Expand context**: the `↑20` / `↓20` / `↕` buttons on hunk headers (and below
  the last hunk) reveal the hidden lines around each hunk, fetched from the
  head revision.
- **Copy file path**: the icon button in each file header copies its path.
- **Comment**: click a line number, or press and drag across line numbers, then
  type in the popup. `⌘↵` saves, `Esc` cancels. Comments on deleted lines are
  tracked against old-file line numbers and marked `(deleted)`.
- **Copy prompt** puts this on the clipboard (without leaving the page):

  ```
  MR: https://gitlab.com/group/repo/-/merge_requests/123

  path/to/file.rb:123-456 - my comment
  which can be multi line

  path/to/file.rb:99 (deleted) - comment on a removed line
  ```

  The first line varies by mode: `MR: <url>`, `PR: <url>`, `Compare: <url>`,
  or `Repo: /path/to/repo (base...head)`.

- **Import** accepts a previously copied prompt (or the raw JSON state) and
  restores those comments.
- **Clear** removes all comments (asks for confirmation first).

Comments are also auto-saved under `~/.codereview-commenter/` (keyed by
MR or by repo + range) as you type, and restored when you reopen the same
review — so import is only needed to move state between machines or resurrect
an old prompt.

## How it works

- `start.mjs` optionally passes a boot target to the Vite dev server via env
  vars (`MR_URL`, `GITHUB_URL`, or `REPO_PATH` + `GIT_BASE`/`GIT_HEAD`/`GIT_RANGE`);
  with no target the UI opens on the start screen.
- A Vite plugin (`vite.config.ts`) resolves each requested target to a
  provider — `server/glab.ts` (glab CLI), `server/github.ts` (gh CLI), or
  `server/localGit.ts` (git CLI) — and serves `/api/mr` (metadata + diffs
  parsed by `server/diff.ts`), `/api/file` (full file content for context
  expansion), `/api/state` (persistence), `/api/repo-info` (branch listing for
  the start screen), and `/api/history` (recent reviews, stored in
  `~/.codereview-commenter/history.json`).
- The React frontend highlights hunks with Shiki (`github-light`/`github-dark`,
  following `prefers-color-scheme`) and renders unified or split views.
