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

# Typecheck the cc-like skill discovery / execution stack.
typecheck-skill-stack:
    just typecheck \
      extensions/cc-like/lib/cc-skill-discovery.ts \
      extensions/cc-like/lib/skill-execution.ts \
      extensions/cc-like/lib/skill-invocation.ts \
      extensions/cc-like/lib/skill-prompt-shims.ts \
      extensions/cc-like/cc-resource-paths.ts \
      extensions/cc-like/skill-prompts.ts \
      extensions/cc-like/skill-tool.ts

# Typecheck the cc-like context + markdown preprocessing stack.
typecheck-context-stack:
    just typecheck \
      extensions/cc-like/lib/cc-context.ts \
      extensions/cc-like/lib/markdown-preprocess.ts \
      extensions/cc-like/lib/startup-summary.ts \
      extensions/cc-like/00-system-prompt-markdown-preprocessor.ts \
      extensions/cc-like/10-cc-context-local-files.ts \
      extensions/cc-like/cc-markdown-preprocessor.ts

# Auto-format the repo.
lint:
    bun x biome format . --write

# Verify formatting without mutating files.
lint-ci:
    bun x biome ci . --linter-enabled=false --assist-enabled=false

# Run all tests.
test:
    bun test

# Run unit tests only.
test-unit:
    bun test tests/unit

# Run integration tests only.
test-integration:
    bun test tests/integration
