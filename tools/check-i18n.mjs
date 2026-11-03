#!/usr/bin/env node
// Lists strings passed to t()/tn() in src/ that a dictionary does not translate.
// Usage: node tools/check-i18n.mjs [lang=ru]   (exit code 1 when keys are missing)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const lang = process.argv[2] ?? "ru";
const root = new URL("../src/", import.meta.url).pathname;
const dictSrc = readFileSync(join(root, "i18n", `${lang}.ts`), "utf8");

// Keys of the dictionary: `  "key": ...` lines.
const keys = new Set();
for (const m of dictSrc.matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:/gm)) keys.add(JSON.parse(m[1]));

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "i18n" && name !== "dev") walk(p);
    } else if (/\.(tsx?|mts)$/.test(name)) files.push(p);
  }
})(root);

const missing = new Map();
const call = /\bt(n)?\(\s*(?:[^,()]+,\s*)?("(?:[^"\\]|\\.)*")/g;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(call)) {
    const key = JSON.parse(m[2]);
    if (!keys.has(key)) missing.set(key, file.slice(root.length));
  }
}
if (missing.size === 0) {
  console.log(`${lang}: all ${keys.size} keys present`);
} else {
  for (const [key, file] of missing) console.log(`${file}: ${JSON.stringify(key)}`);
  console.log(`\n${missing.size} string(s) missing from ${lang}.ts`);
  process.exit(1);
}
