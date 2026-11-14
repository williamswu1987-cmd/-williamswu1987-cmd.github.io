#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function git(args, allowFail) {
  const res = spawnSync("git", args, { encoding: "utf8" });
  if (res.error) {
    console.error(res.error.message);
    process.exit(2);
  }
  if (res.status !== 0) {
    if (allowFail) return null;
    const detail = (res.stderr || res.stdout || "git failed").trim();
    console.error(detail);
    process.exit(2);
  }
  return res.stdout;
}

function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]).trim();
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${flag}`);
    process.exit(2);
  }
  return value;
}

function readText(rev, rel) {
  if (!rev) {
    const full = path.join(repoRoot(), rel);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full, "utf8");
  }
  return git(["show", `${rev}:${rel}`], true);
}

function quotedStrings(block) {
  const found = [];
  const re = /["']([^"']+)["']/g;
  let match = re.exec(block);
  while (match) {
    found.push(match[1]);
    match = re.exec(block);
  }
  return found;
}

function parseCopyList(source) {
  if (source == null) return null;
  const filesBlock = source.match(/const\s+files\s*=\s*\[([\s\S]*?)\];/);
  if (!filesBlock) return null;
  const files = quotedStrings(filesBlock[1]);
  const dirs = [];
  const dirRe = /copyDir\(\s*path\.join\(\s*root\s*,\s*["']([^"']+)["']/g;
  let dirMatch = dirRe.exec(source);
  while (dirMatch) {
    dirs.push(dirMatch[1].replace(/\/$/, ""));
    dirMatch = dirRe.exec(source);
  }
  return { files, dirs };
}

function pageReferences(html) {
  const refs = [];
  const re = /\b(?:src|href)\s*=\s*["']([^"']+)["']/g;
  let match = re.exec(html);
  while (match) {
    let url = match[1].trim();
    if (url && !url.startsWith("#") && !url.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      url = url.split("#")[0].split("?")[0].replace(/^\.\//, "").replace(/^\//, "");
      if (url && !url.endsWith("/")) refs.push(url);
    }
    match = re.exec(html);
  }
  return [...new Set(refs)];
}

function covered(ref, list) {
  if (list.files.includes(ref)) return true;
  return list.dirs.some((dir) => ref === dir || ref.startsWith(`${dir}/`));
}

function main() {
  const rev = argValue("--rev");
  const label = rev || "worktree";
  const html = readText(rev, "index.html");
  const build = readText(rev, "scripts/build-www.js");
  if (html == null) {
    console.error(`index.html is missing at ${label}.`);
    process.exit(2);
  }
  const list = parseCopyList(build);
  if (!list) {
    console.error(`scripts/build-www.js at ${label} has no const files = [ ... ] string list.`);
    process.exit(1);
  }
  const missing = pageReferences(html).filter((ref) => !covered(ref, list)).sort();
  if (missing.length > 0) {
    console.error(`www copy list is missing files index.html loads (${label}):`);
    for (const ref of missing) console.error(`  ${ref}`);
    console.error("Add each path to the files array in scripts/build-www.js, or copy its directory with copyDir.");
    process.exit(1);
  }
  const count = pageReferences(html).length;
  console.log(`www build check passed (${label}, ${count} page files covered, ${list.files.length} explicit files, dirs: ${list.dirs.join(", ") || "none"})`);
}

main();
