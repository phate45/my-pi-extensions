# my-pi-extensions

This repo holds my Pi setup.

It is a local Pi package with:
- extensions
- themes
- Claude-style compatibility shims
- a few personal hacks that make Pi behave the way I want

## No guarantees

This is not a polished distribution, supported product, or stability promise.
I use it to shape my own Pi environment, and I am perfectly willing to monkey-patch Pi internals when the public API stops one layer short of useful.

If you copy parts of it, assume:
- paths may be specific to my machine
- behavior may depend on my `~/.pi/agent` setup
- some extensions exist because I wanted a thing now, not because the design is blessed
- Pi updates may break the sharper hacks

## Layout

- `extensions/cc-like/` — Claude Code-like behavior for skills, prompts, context loading, and startup UX
- `extensions/my-stuff/` — personal extensions, tools, and experiments
- `themes/` — theme files
- `.pi/skills/` — Pi-local skills that belong with this repo
- `.claude/` — Claude-style project resources consumed through the compatibility layer

## Inspired by

This setup borrows ideas, patterns, or reference material from:
- [`davis7dotsh/my-pi-setup`](https://github.com/davis7dotsh/my-pi-setup/)
- [`earendil-works/pi` coding-agent extension examples](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions)

## Use at your own risk

If Pi changes under us and something explodes, that is not a bug in the README. That is the price of doing fun surgery on the runtime.
