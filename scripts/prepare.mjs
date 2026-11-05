import { copyFileSync, mkdirSync } from "node:fs";
import { metadata } from "./metadata.mjs";
metadata(process.env.RELEASE_TAG);
const destination = new URL("../src/resources/legal/", import.meta.url);
mkdirSync(destination, { recursive: true });
copyFileSync(
  new URL("../LICENSE", import.meta.url),
  new URL("LICENSE", destination),
);
