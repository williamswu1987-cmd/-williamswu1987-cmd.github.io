#!/usr/bin/env node
"use strict";

const fs = require("fs");
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

function shellPath(raw) {
  const path = raw.replace(/^\.\//, "").replace(/^\//, "");
  if (!path || path === ".") return null;
  return path;
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

function parseServiceWorker(source) {
  if (source == null) return { cacheName: null, shell: [] };
  const cache = source.match(/const\s+CACHE\s*=\s*["']([^"']+)["']/);
  const shellBlock = source.match(/const\s+SHELL\s*=\s*\[([\s\S]*?)\];/);
  const shell = [];
  if (shellBlock) {
    for (const raw of quotedStrings(shellBlock[1])) {
      const path = shellPath(raw);
      if (path) shell.push(path);
    }
  }
  return { cacheName: cache ? cache[1] : null, shell };
}

function rangeFromArgs() {
  const base = argValue("--base");
  const head = argValue("--head");
  if (!base && !head) return null;
  if (!base || !head) {
    console.error("Pass both --base and --head.");
    process.exit(2);
  }
  return { base, head, mode: "explicit" };
}

function rangeFromGithubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!eventPath || !eventName || !fs.existsSync(eventPath)) return null;
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  if (eventName === "pull_request" && event.pull_request) {
    return {
      base: event.pull_request.base.sha,
      head: event.pull_request.head.sha,
      mode: "pull_request",
    };
  }
  if (eventName === "push" && event.before && event.after && !/^0+$/.test(event.before)) {
    return { base: event.before, head: event.after, mode: "push" };
  }
  return null;
}

function rangeFromLocal() {
  const head = git(["rev-parse", "HEAD"]).trim();
  const main = git(["rev-parse", "--verify", "origin/main"], true);
  if (!main) return { base: "HEAD^", head: "HEAD", mode: "parent" };
  const mainSha = main.trim();
  if (mainSha === head) return { base: "HEAD^", head: "HEAD", mode: "main" };
  const mergeBase = git(["merge-base", "origin/main", "HEAD"]).trim();
  if (mergeBase === head) return { base: "HEAD^", head: "HEAD", mode: "main" };
  return { base: mergeBase, head: "HEAD", mode: "branch" };
}

function changedPaths(base, head) {
  const out = git(["diff", "--name-only", base, head]);
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

function main() {
  const range = rangeFromArgs() || rangeFromGithubEvent() || rangeFromLocal();
  const baseSw = parseServiceWorker(git(["show", `${range.base}:sw.js`], true));
  const headSw = parseServiceWorker(git(["show", `${range.head}:sw.js`], true));
  const shell = new Set([...baseSw.shell, ...headSw.shell]);
  const changedShell = changedPaths(range.base, range.head).filter((path) => shell.has(path)).sort();
  const cacheLabel = `${baseSw.cacheName || "none"} -> ${headSw.cacheName || "none"}`;

  if (changedShell.length > 0 && (!headSw.cacheName || headSw.cacheName === baseSw.cacheName)) {
    console.error(`CACHE in sw.js was not bumped (${cacheLabel}).`);
    console.error(`Precached files changed between ${range.base} and ${range.head}:`);
    for (const path of changedShell) console.error(`  ${path}`);
    console.error('Change the CACHE string in sw.js in the same revision, for example "protiva-shell-vN".');
    process.exit(1);
  }

  console.log(
    `sw cache check passed (${range.mode}: ${range.base}..${range.head}, ${cacheLabel}, shell files changed: ${changedShell.length})`
  );
}

main();
