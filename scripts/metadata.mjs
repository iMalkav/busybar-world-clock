import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export function metadata(tag) {
  const read = (name) =>
    JSON.parse(readFileSync(new URL("../" + name, import.meta.url), "utf8"));
  const pkg = read("package.json"),
    manifest = read("src/appmeta/manifest.json");
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (
    manifest.format_version !== 1 ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,31}$/.test(manifest.id)
  )
    throw new Error("Invalid application manifest");
  if (!stable.test(manifest.version) || manifest.version !== pkg.version)
    throw new Error("Package and manifest versions must match");
  if (!stable.test(manifest.api_version))
    throw new Error("Invalid minimum HTTP API version");
  if (tag !== undefined && tag !== manifest.version)
    throw new Error("Release tag must match application version");
  if (
    typeof manifest.name !== "string" ||
    !manifest.name.trim() ||
    /[\r\n]/.test(manifest.name)
  )
    throw new Error("Invalid application name");
  if (
    !Number.isInteger(manifest.heap_size_kib) ||
    manifest.heap_size_kib < 1 ||
    manifest.heap_size_kib > 512
  )
    throw new Error("Invalid heap size");
  const settings = read("src/appmeta/settings.json");
  if (
    settings.format_version !== 1 ||
    settings.version !== 1 ||
    !settings.fields ||
    Array.isArray(settings.fields)
  )
    throw new Error("Invalid settings schema");
  return {
    ...manifest,
    archive: manifest.id + "-" + manifest.version + ".tgz",
  };
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const value = metadata(process.argv[2] ?? process.env.RELEASE_TAG);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      "archive=" + value.archive + "\n",
    );
  console.log(value.name + " " + value.version + ", API " + value.api_version);
}
