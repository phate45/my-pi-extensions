---
description: Compact the current conversation into a handoff document for another agent to pick up here
argument-hint: "[next-session-focus]"
---
Write a handoff document that lets a fresh agent continue this work in this repository.

Built-in file status checks:

! if [ -f .tmp/handoff.md ]; then echo "handoff exists: .tmp/handoff.md"; else echo "handoff missing: .tmp/handoff.md"; fi

! day=$(date +%F); file="$HOME/Documents/second-brain/01_Projects/my-pi-extensions/logs/$day.md"; if [ -f "$file" ]; then echo "work log exists: $file"; else echo "work log missing: $file"; fi

Save the handoff to `.tmp/handoff.md` in this project. Overwrite the file if it already exists.

Treat any provided arguments as steering for what the next session should focus on.

Steering text provided by the user:
<handoff-steering>
$ARGUMENTS
</handoff-steering>

If the steering block above is empty, default to: continue the current work here.

Requirements for the handoff:
- Summarize the current conversation, current code state, active decisions, open questions, and the next concrete steps.
- Include a **Next session focus** section that reflects the provided steering when present, or the default focus when not.
- Include a **Suggested Skills** section listing skills the next agent should invoke.
- Do not duplicate content already captured in other artifacts such as plans, ADRs, issues, commits, or diffs. Reference those artifacts by path or URL instead.
- Redact sensitive information such as API keys, passwords, tokens, or personally identifiable information.
- Make the handoff specific to continuing work **here**, not as a generic summary.

Also check whether today's work log has already been written.
- If no work log exists yet for today, write it.
- If a work log exists but this session added meaningful work that is not documented yet, update it before you finish.

Handoffs are for the next session; work logs are for what was done. Do not assume an existing log file is complete.
