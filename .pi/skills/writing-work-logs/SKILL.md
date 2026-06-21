---
name: writing-work-logs
description: Write work session logs for the vault. Use when documenting completed work, at session end, or when Mark asks to log work.
---

# Writing Work Logs

## Location

Work logs live at: `~/Documents/second-brain/01_Projects/my-pi-extensions/logs/YYYY-MM-DD.md`

Today's log status:

! day=$(date +%F); file="$HOME/Documents/second-brain/01_Projects/my-pi-extensions/logs/$day.md"; if [ -f "$file" ]; then printf 'exists: %s\n\n' "$file"; printf 'tail -5:\n'; tail -n 5 "$file"; else printf 'missing: %s\n' "$file"; fi

## Writing Style

@/home/agent/.claude/skills/technical-writing/SKILL.md

## File Format

```markdown
---
created: 2025-12-22T14:30:00
modified: 2025-12-22T14:30:00
---

## [Topic/Theme]

Opening narrative paragraph explaining what was accomplished and why.

**Subsection Header:**
- Specific implementation detail
- Another concrete point
- Reasoning or context

**Another Subsection:**
- More details
- Technical decisions made

---

## [Another Topic]

[Next work block...]
```

## Writing Guidelines

### Do

- Use `## [Topic]` headings for each work block
- Write opening narrative explaining the "why"
- Use **bold subsection headers** for aspects
- Include specific, concrete details
- Explain reasoning and tradeoffs
- Use active voice throughout

### Avoid

- Passive voice ("was updated", "has been changed")
- Vague terms ("improved", "worked on", "fixed some issues")
- Minimal summaries without context
- File-change lists without narrative

## Example

**Bad (file-change list):**
```
- Updated CLAUDE.md
- Created 3 skills
- Deleted AGENTS.md
```

**Good (narrative with context):**
```markdown
## Documentation Progressive Disclosure Refactor

Restructured agent documentation to use progressive disclosure pattern. Context-triggered knowledge moved from always-loaded CLAUDE.md into skills that activate when needed.

**Skills Created:**
- `creating-tasks` - Good description patterns, proper flags
- `landing-the-plane` - Session-end protocol with anti-patterns
- `writing-work-logs` - This meta-skill for Control Tower

**Rationale:**
Agents don't need landing protocol in context during implementation work. Loading it only at session end reduces token overhead and keeps focus on current task.

**Doc Changes:**
- CLAUDE.md absorbed quick reference from deleted AGENTS.md
- AGENTS.md removed (content distributed to skills)
```

## Timestamps

Current timestamp:

```md
! date '+%A, %Y-%m-%dT%H:%M:%S'
```

### Updating timestamps

- For a new daily log file, set both `created` and `modified` to the timestamp shown above.
- The frontmatter timestamp extension owns `modified` updates for tracked files; don't hand-roll a replacement timestamp when that path is active.
- Use what's written above, don't call `date` again; never placeholders like `00:00:00`.
