#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const www = path.join(root, "www");

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

rmrf(www);
fs.mkdirSync(www, { recursive: true });

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "geo.js",
  "monetization.js",
  "privacy.html",
  "terms.html",
  "manifest.webmanifest",
  "sw.js",
];

for (const f of files) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) copyFile(src, path.join(www, f));
}

copyDir(path.join(root, "data"), path.join(www, "data"));
if (fs.existsSync(path.join(root, "assets"))) {
  copyDir(path.join(root, "assets"), path.join(www, "assets"));
}

console.log("Built www/ for Capacitor");
