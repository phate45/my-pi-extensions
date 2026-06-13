---
name: skill-argument-test
description: Minimal verification skill for checking that /skill prompt arguments reach skill expansion correctly. Use when debugging skills-as-prompts argument passing.
arguments:
  - subject
argument-hint: "<subject>"
disable-model-invocation: false
user-invocable: true
---

# Skill Argument Test

Load this skill with a single argument, for example:

```text
/skill:skill-argument-test orbit
```

Then report the exact expanded values for:

- `FULL`: `$ARGUMENTS`
- `AT`: `$@`
- `INDEXED_0`: `$ARGUMENTS[0]`
- `ZERO_ALIAS`: `$0`
- `ONE_SHORTHAND`: `$1`
- `NAMED_SUBJECT`: `$subject`

If any of those are empty or mismatched, call it out explicitly.
