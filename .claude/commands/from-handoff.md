---
description: Load the current handoff into context and get situated
argument-hint: "[steering]"
disable-model-invocation: true
---
Get situated using the current handoff for this project.

If `.tmp/handoff.md` exists, treat it as the primary handoff for the next steps:

! if [ -f .tmp/handoff.md ]; then cat .tmp/handoff.md; else echo "No handoff found at .tmp/handoff.md"; fi

If today's work log exists, you have the option to reference it for reasoning support:

! day=$(date +%F); file="$HOME/Documents/second-brain/01_Projects/my-pi-extensions/logs/$day.md"; if [ -f "$file" ]; then echo "work log exists: $file"; else echo "work log missing: $file"; fi

Instructions:
- Read the embedded handoff content above as immediate context.
- Get oriented in the repo and identify the current state of the work.
- If the handoff references other artifacts, use them instead of re-inventing their contents.
- If no handoff exists, say so plainly and propose the fastest safe way to re-establish context.

If the user passed arguments, treat them as steering for how to continue next:
- Steering: ${ARGUMENTS:-none}

Based on that steering, propose how to continue from the handoff and highlight the first concrete action you would take.
