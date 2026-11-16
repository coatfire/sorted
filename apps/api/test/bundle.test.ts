import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("loads the production bundle without local database drivers installed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sorted-production-bundle-"));
  try {
    const result = await build({
      entryPoints: [new URL("../src/lambda.ts", import.meta.url).pathname],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      external: ["@electric-sql/pglite"],
      banner: { js: "import { createRequire as bannerRequire } from 'module'; const require = bannerRequire(import.meta.url);" },
      write: false,
    });
    const entry = join(dir, "index.mjs");
    await writeFile(entry, result.outputFiles[0].contents);
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--input-type=module", "-e",
      `const { handler } = await import(${JSON.stringify(pathToFileURL(entry).href)});
       if (typeof handler !== "function") throw new Error("Missing Lambda handler");
       console.log("Production bundle loaded without local drivers");`,
    ], {
      env: {
        ...process.env,
        DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
        NODE_ENV: "production",
        VERCEL: "1",
      },
    });
    expect(stdout.trim()).toBe("Production bundle loaded without local drivers");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
