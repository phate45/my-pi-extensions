---
name: skill-preprocessor-test
description: Test skill for verifying Pi skill-tool frontmatter parsing, argument substitution, SKILL_DIR expansion, and skill markdown preprocessing.
when_to_use: Use when Mark asks to test the experimental Pi skill tool or skill preprocessing behavior.
arguments:
  - issue
  - branch
argument-hint: "[issue] [branch]"
disable-model-invocation: false
user-invocable: true
---

# Skill Preprocessor Test

You are running the `skill-preprocessor-test` skill. Do not perform unrelated work. Verify and report the exact observed state of this loaded skill body.

## Expected invocation

For the best test, Mark should invoke this skill as:

```text
/skill:skill-preprocessor-test ISSUE-123 feature/test-branch
```

## Substitution checks

Report whether each of these expanded correctly:

- `SKILL_DIR`: `${SKILL_DIR}`
- `ARGUMENTS_FULL`: `$ARGUMENTS`
- `ARGUMENTS_AT`: `$@`
- `ARGUMENT_0_INDEXED`: `$ARGUMENTS[0]`
- `ARGUMENT_1_INDEXED`: `$ARGUMENTS[1]`
- `ARGUMENT_0_ALIAS`: `$0`
- `ARGUMENT_1_SHORTHAND`: `$1`
- `ARGUMENT_2_SHORTHAND`: `$2`
- `ARGUMENT_NAMED_ISSUE`: `$issue`
- `ARGUMENT_NAMED_BRANCH`: `$branch`

## Preprocessing checks

The following command should execute from any cwd because `${SKILL_DIR}` expands before command preprocessing:

! bash ${SKILL_DIR}/scripts/report-skill-dir.sh

The following file embed should resolve relative to the skill directory:

@references/fixture.txt

## Required response

Respond with a compact verification report containing:

1. Whether the skill loaded through the new `skill` execution path.
2. The expanded values for all substitution checks above.
3. Whether the command-output block appeared and printed the skill script location.
4. Whether the fixture file-content block appeared.
5. Whether an `ARGUMENTS: ...` fallback line was appended. Because this skill body contains `$ARGUMENTS`, the fallback line should **not** appear.
