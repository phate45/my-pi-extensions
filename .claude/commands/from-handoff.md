---
description: Load the current handoff into context and get situated
argument-hint: "[steering]"
disable-model-invocation: true
---
Get situated using the current handoff for this project.

If `.tmp/handoff.md` exists, its contents are embedded below.
Treat the embedded handoff block as the primary handoff for the next steps.
Do not spend a tool call re-reading `.tmp/handoff.md` unless you have a specific reason to verify that the embedded handoff is stale or inconsistent.

<handoff-contents>
!if [ -f .tmp/handoff.md ]; then cat .tmp/handoff.md; fi
</handoff-contents>

If today's work log exists, you may reference it for reasoning support:

work log exists: /home/agent/Documents/second-brain/01_Projects/my-pi-extensions/logs/2026-06-20.md

Instructions:
- Read the embedded handoff block inside `<handoff-contents>` above as immediate context.
- Treat that embedded handoff block as the primary handoff for this prompt, not as a hint to go read the file again.
- Get oriented in the repo and identify the current state of the work.
- If the embedded handoff references other artifacts, use them instead of re-inventing their contents.
- If no handoff contents are embedded, say so plainly and propose the fastest safe way to re-establish context.

If the user passed arguments, treat them as steering for how to continue next.

Steering text provided by the user:
<handoff-steering>
$ARGUMENTS
</handoff-steering>

If the steering block above is empty, continue from the handoff without additional steering.

Based on that steering, propose how to continue from the handoff and highlight the first concrete action you would take.
