import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

for (const cli of ["dist/cli.js", "dist/bundle/cli.js"]) {
  test(`docs resolver locates pnpm package with ${cli}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-docs-"));
    roots.push(root);
    const bin = path.join(root, "bin");
    const pkg = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent");
    await mkdir(bin);
    await mkdir(path.join(pkg, "docs"), { recursive: true });
    await writeFile(path.join(pkg, "README.md"), "docs");
    await writeFile(
      path.join(bin, "pi"),
      `#!/bin/sh\nexec node "$basedir_win/../node_modules/@earendil-works/pi-coding-agent/${cli}" "$@"\nexec node "$basedir/../node_modules/@earendil-works/pi-coding-agent/${cli}" "$@"\n`,
      { mode: 0o755 },
    );
    const output = execFileSync("bash", ["scripts/render-pi-doc-paths.sh"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(output).toContain(`Main documentation: ${pkg}/README.md`);
    expect(output).toContain(`Additional docs: ${pkg}/docs`);
    expect(output).toContain(`Local extension bundle: ${process.cwd()}`);
    expect(output).toContain(`${process.cwd()}/docs/bundle-config.md`);
  });
}
