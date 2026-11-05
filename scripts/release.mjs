import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { metadata } from "./metadata.mjs";
const app = metadata(process.env.RELEASE_TAG);
const root = new URL("../dist/", import.meta.url);
const source = new URL(app.id + ".tgz", root);
const manifest = JSON.parse(
  execFileSync(
    "tar",
    ["-xOf", fileURLToPath(source), app.id + "/appmeta/manifest.json"],
    { encoding: "utf8" },
  ),
);
if (
  manifest.version !== app.version ||
  manifest.id !== app.id ||
  manifest.api_version !== app.api_version
)
  throw new Error("Rebuild the application before preparing a release");
copyFileSync(source, new URL(app.archive, root));
const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
writeFileSync(new URL("SHA256SUMS", root), hash + "  " + app.archive + "\n");
writeFileSync(
  new URL("RELEASE_NOTES.md", root),
  "# " +
    app.name +
    " " +
    app.version +
    "\n\n" +
    app.description +
    "\n\n- Application ID: " +
    app.id +
    "\n- Minimum HTTP API: " +
    app.api_version +
    "\n- Package: " +
    app.archive +
    "\n\nSee INSTALL.md in the source repository for installation instructions.\n",
);
console.log("Prepared " + app.archive);
