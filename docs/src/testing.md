---
title: Testing the pre-1.0 build
abstract: Test lazylab's complete developer workflow against a real GitLab project and report the differences between expected and actual behaviour.
---

## What is ready to test

lazylab has enough functionality for a complete trial: pick an issue, brief an agent, work on a branch, inspect CI failures, save a handoff, and resume the task in another session. The next milestone is evidence from real use. The [feature status](/reference/status/) page separates local verification from live GitLab checks.

GitLab CI now defines an app check for branches, tags and merge requests. It installs from the frozen lockfile, checks TypeScript, runs the tests, builds the app, compiles the CLI and checks the binary's version. The same check must succeed before a default-branch pipeline publishes documentation. Hosted runner execution is still a separate check from running these commands locally.

## Before the trial

Install lazylab using [Getting started](/getting-started/) and add a live GitLab profile. Use a project where you can create a test issue, branch, pipeline and merge request. Record the GitLab version, lazylab commit, Bun version, OS and whether lazylab runs on metal or in Docker.

For source builds, run the same app commands as CI:

```bash
# Shell: bash, lazylab repository root
bun install --frozen-lockfile
bun run lint
bun test
bun run build
bun run cli:build
./dist-cli/lazy --version
```

Connect your coding agent through [MCP](/agents/mcp/) and configure the [CLI](/cli/). For the optional knowledge workflow, connect an existing [BugKB service](/agents/knowledge/). Both the tests and the KB integration are usable without granting agents secret access.

## Trial workflow

| Step | Exercise | Expected result |
|---|---|---|
| First run and restart | Set up, add a GitLab profile, restart, then sign in | The vault remains encrypted and locked after restart; signing in resumes the connection |
| Pick work | Compare the inbox with GitLab's own issue and MR views | Entries belong to your member projects and describe who needs to act; source failures are visible |
| Brief an agent | Request `get_task_briefing` for a real issue and an MR | Descriptions, acceptance checks, discussion, patches and pipeline state match GitLab; missing sources and clipping are explicit |
| Change sessions | Save a handoff with decisions, attempted fixes, actual checks and next steps, then start a fresh agent session | The new session receives the checkpoint without needing the old conversation |
| Check freshness | Save an MR handoff with its full head SHA, then push another commit | The next MR briefing marks that handoff as no longer matching the current head |
| Follow CI | Push a branch, follow its pipeline and inspect a failed job | Status and the failure excerpt match GitLab; the watch notifies you when the pipeline finishes |
| Exercise notifications | Send a watch result to a configured browser or phone channel | The real receiving device gets the expected status and project link |
| Switch profiles | Read identically numbered tasks on two GitLab profiles | Task handoffs stay with their original profile |
| Reuse a finding | Search BugKB, read a result, and test whether its environment and fix apply | Relevant findings carry trust and evidence; search alone never confirms them |
| Record a lesson | Explicitly add a verified, reusable finding; try adding the same one again | The first record keeps its evidence; the duplicate is refused with the existing ID |
| Lose the KB connection | Stop the test KB or use an unreachable endpoint, then request a briefing | The GitLab task context still loads and the KB source is marked unavailable |

Use the same issue or MR reference when saving and resuming a handoff. A handoff's `done` status is an agent report; inspect the actual diff and verification before accepting the result.

## Known limits to account for

- Most list views read the first 50 entries per project; cross-project aggregation uses the 15 most recently active member projects. Large installations can therefore have missing items.
- The inbox aggregates the active GitLab profile. It does not yet combine every configured host.
- Agent tokens act as the owner on the active profile; project and tool allowlists remain planned. Secret reads are separately gated by the token's secret-access flag.
- Briefings intentionally bound discussion, related MRs, patches and failure excerpts. Read their `errors` and `omissions` fields before treating them as complete context.
- CLI environment handling, notifications on real devices, live GitLab version differences, Windows and Docker networking still need broader acceptance testing.
- CI does not yet build the Docker image or release a platform matrix of CLI binaries.

These limits are recorded in the [development tracker](https://gitlab.com/sgkens/lazylab/-/blob/develop/devtracker-pending.md). Findings from the trial should determine the next feature work.

## Report a failure

Capture the smallest reproducible case, expected result, actual result, affected project/task type, versions and commit. Include the relevant source error, failure excerpt or console message. Keep tokens, passwords and CI variable values out of reports.

For agent workflow reports, also note the MCP client, whether its token has secret access, and whether the same request works through `lazy --json`. For notification reports, identify the channel and whether a capture server or a real device was used.

Record reusable verified fixes in BugKB. Use an issue for product defects and the handoff history for unfinished task context.
