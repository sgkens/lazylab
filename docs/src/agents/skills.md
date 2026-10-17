---
title: Agent skills
abstract: The repository ships a lazylab-agent skill for Claude Code, Codex and Antigravity that teaches an agent the writing rules for issues and merge requests and the REST endpoints.
---

## Layout

```text
skills/
  .claude/lazylab-agent/SKILL.md        source copy
  .codex/lazylab-agent/SKILL.md         identical
  .antigravity/lazylab-agent/SKILL.md   identical
```

The files use the Agent Skills format: YAML front matter with `name` and `description`, then a Markdown body. The running server also serves the `.claude` copy at `/api/agent/skill.md`.

## Install

Shell: bash, repository root.

```bash
# Claude Code (user scope)
ln -s "$PWD/skills/.claude/lazylab-agent" ~/.claude/skills/lazylab-agent

# Codex (user scope)
ln -s "$PWD/skills/.codex/lazylab-agent" ~/.codex/skills/lazylab-agent

# Antigravity (workspace scope, inside the project that should use it)
mkdir -p .agent/skills && ln -s "$PWD/skills/.antigravity/lazylab-agent" .agent/skills/lazylab-agent
```

Check the skills directory for your Codex and Antigravity versions; it has changed between releases.

## MCP or skill

If the lazylab MCP server is connected, the skill tells the agent to use its tools. The writing rules still apply. The REST section is for agents without MCP and for scripts.

## Writing rules in the skill

- Plain technical English, without filler.
- Imperative, scoped titles, for example `[cache] Expire entries on TTL`.
- Issue bodies: `### Summary`, `### What changed`, `### Acceptance criteria` with `- [ ]` items. lazylab shows those items as subtasks.
- Merge request bodies: `### Overview`, `### Changes`, `### Verification`.

## Keeping the copies in sync

Shell: bash, repository root.

```bash
for host in .codex .antigravity; do
  cp skills/.claude/lazylab-agent/SKILL.md "skills/$host/lazylab-agent/SKILL.md"
done
```
