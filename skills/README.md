# lazylab agent skills

Agent skills that let coding agents (Claude Code, Codex, Antigravity) drive a locally running lazylab instance.

## Layout

```
skills/
  .claude/lazylab-agent/SKILL.md
  .codex/lazylab-agent/SKILL.md
  .antigravity/lazylab-agent/SKILL.md
```

All three use the Agent Skills `SKILL.md` format (YAML frontmatter with `name` and `description`, Markdown body). The `.claude` copy is the source; the other two are kept identical.

## Install

Copy or symlink the skill folder into each host's skills directory. Shell: bash, run from the repo root.

```bash
# Claude Code (user scope)
ln -s "$PWD/skills/.claude/lazylab-agent" ~/.claude/skills/lazylab-agent

# Codex (user scope)
ln -s "$PWD/skills/.codex/lazylab-agent" ~/.codex/skills/lazylab-agent

# Antigravity (workspace scope, inside the project that should use it)
mkdir -p .agent/skills && ln -s "$PWD/skills/.antigravity/lazylab-agent" .agent/skills/lazylab-agent
```

Check the skills directory path for your installed Codex and Antigravity versions; it has changed between releases.

## Sync

After editing the `.claude` copy, sync the others. Shell: bash, repo root.

```bash
for host in .codex .antigravity; do cp skills/.claude/lazylab-agent/SKILL.md "skills/$host/lazylab-agent/SKILL.md"; done
```
