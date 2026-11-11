# Review guidelines

Read by the automated reviewer on every pull request and by humans who want
the same checklist. Keep it short: the reviewer reads it on every run.

## What to report

Report things that would change the outcome of a merge: defects, security
gaps, data-integrity risks, behaviour that contradicts the PR description,
and deviations from the conventions below. Do not report style that Prettier
or ESLint already handle, do not restate the diff, do not praise.

Give each finding a severity:

- blocker: wrong results, data loss, auth bypass, secrets exposed, broken
  migration
- should-fix: a real bug or convention breach that should land before merge
- consider: a judgement call worth a sentence, the author decides

If there is nothing worth saying, say so in one line.

To decline or defer a finding, post a top-level comment on the pull request
with the reason. The reviewer reads those comments on its next run, does not
raise the finding again, and lists it in a closing section so human reviewers
still see it. Write "declined" when the finding will not be acted on and
"deferred" when it moves to another issue or pull request, and name that issue
or pull request. Inline review threads and review summaries are not read.

## Repository conventions

- Guard clauses and early returns over nested if/else.
- Minimal comments. No section headers, no narration of what the code does.
- TEXT over VARCHAR(n) in models and migrations.
- creationDate and lastUpdate are ISO-8601 text set explicitly in each
  endpoint. A handler that mutates a row and does not bump lastUpdate is a
  finding.
- Migrations under db/migrations are plain .js on purpose. They must run on
  PostgreSQL and SQLite, every up needs a matching down, and long-running work
  must not sit in one transaction.
- Compliance status colours come from the tokens in tailwind.config.js.
  Hardcoded status colours in components are a finding.
- Pull request titles are Conventional Commits. The title check enforces the
  type, the reviewer checks that the title describes the change.

## Server code (server/**)

- Every handler validates the session and checks that the caller may access
  the specific resource. Reading an id from the body or query and using it
  without an ownership or role check is a blocker.
- No string-built SQL.
- Never log request bodies, tokens, passwords or session ids.
- Imports and exports stream large files. Buffering a whole upload in memory
  is a should-fix.

## Frontend (components, pages, layouts, composables, stores)

- Vue 3 script setup, Pinia for shared state, Tailwind for styling.
- Fetches handle the error path and surface it through the alerts store.
- State that two components share belongs in a store, not in props drilled
  three levels deep.

## End-to-end tests (tests/e2e)

- Each test creates the data it needs. The review slot keeps its database
  between pushes, so leftovers from another test are not a fixture.
- Admin and User roles are mutually exclusive. Use the adminPage and userPage
  fixtures, never one shared account.
- Nothing in a test may log, screenshot or trace a credential.

## Workflows (.github/**)

- Changes here can alter what runs on the deploy runner. Look for secrets reaching
  logs or artifacts, permissions blocks wider than the job needs, third-party
  actions that are not pinned, and anything that lets PR content reach a shell
  unquoted.

## Pull request description

- The Testing section must describe verification that was actually run:
  manual steps, e2e or unit tests, a production build. Lint, format and
  typecheck on their own are not testing. An empty or template-only Testing
  section is a should-fix.
- A breaking change needs a BREAKING CHANGE paragraph in the description,
  because the description becomes the squash commit body.
