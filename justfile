set shell := ["bash", "-cu"]

_default:
    @just --list

tsc_flags := "--noEmit --target es2022 --module nodenext --moduleResolution nodenext --allowSyntheticDefaultImports --esModuleInterop --strict --skipLibCheck"

# Typecheck specific files.
typecheck *files:
    bun x tsc {{tsc_flags}} {{files}}

# Typecheck all extensions.
typecheck-all:
    bun x tsc {{tsc_flags}} $(fd -e ts . extensions -HI | sort)

# Typecheck the Claude skill discovery / execution stack.
typecheck-skill-stack:
    just typecheck \
      extensions/lib/claude-skill-discovery.ts \
      extensions/lib/skill-execution.ts \
      extensions/lib/skill-prompt-shims.ts \
      extensions/claude-skill-paths.ts \
      extensions/skill-tool.ts

# Typecheck the Claude context + markdown preprocessing stack.
typecheck-context-stack:
    just typecheck \
      extensions/lib/claude-context.ts \
      extensions/lib/markdown-preprocess.ts \
      extensions/lib/startup-summary.ts \
      extensions/00-system-prompt-markdown-preprocessor.ts \
      extensions/10-claude-context-local-files.ts \
      extensions/claude-markdown-preprocessor.ts
