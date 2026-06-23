/**
 * Copies `version` from package.json → src-tauri/tauri.conf.json + Cargo.toml [package].
 * Run after changing package.json (including `pnpm version` / manual CalVer bumps).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const v = pkg.version;

if (typeof v !== "string" || !/^\d+\.\d+\.\d+/.test(v)) {
  console.error(
    "package.json version must be a semver-shaped string (e.g. CalVer 2026.4.0).",
  );
  process.exit(1);
}

// MSI/WiX caps the major field at 255, so the CalVer year (e.g. 2026) overflows.
// Derive a WiX-valid version from CalVer YYYY.M.MICRO -> (YYYY-2000).M.MICRO, which
// fits the limits and stays monotonic year-over-year (valid through 2255).
const [year, month, micro] = v.split(".").map(Number);
const wixMajor = year - 2000;
if (wixMajor < 0 || wixMajor > 255) {
  console.error(
    `Cannot derive a WiX version from "${v}": major field ${wixMajor} is outside 0-255.`,
  );
  process.exit(1);
}
const wixVersion = `${wixMajor}.${month}.${micro}`;

const tauriPath = join(root, "src-tauri", "tauri.conf.json");
const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
tauri.version = v;
tauri.bundle ??= {};
tauri.bundle.windows ??= {};
tauri.bundle.windows.wix ??= {};
tauri.bundle.windows.wix.version = wixVersion;
writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);

const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargoLines = readFileSync(cargoPath, "utf8").split("\n");
let inPackage = false;
let updated = false;
for (let i = 0; i < cargoLines.length; i++) {
  const line = cargoLines[i];
  if (line.trim() === "[package]") {
    inPackage = true;
    continue;
  }
  if (line.startsWith("[") && line.includes("]")) {
    inPackage = false;
    continue;
  }
  if (inPackage && /^version\s*=\s*"/.test(line)) {
    cargoLines[i] = `version = "${v}"`;
    updated = true;
    break;
  }
}
if (!updated) {
  console.error("Could not find [package] version in Cargo.toml");
  process.exit(1);
}
writeFileSync(cargoPath, cargoLines.join("\n"));

console.log(
  `Synced version ${v} to tauri.conf.json and Cargo.toml (WiX ${wixVersion}).`,
);
