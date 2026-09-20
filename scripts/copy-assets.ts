import fs from "node:fs";
import path from "node:path";
const src = path.join(__dirname, "..", "src", "web", "public");
const dest = path.join(__dirname, "..", "dist", "web", "public");
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`Copied static assets: ${src} -> ${dest}`);