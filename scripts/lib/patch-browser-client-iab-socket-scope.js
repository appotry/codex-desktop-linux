#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const clientPath = process.argv[2];
if (!clientPath) {
  throw new Error(
    "Usage: patch-browser-client-iab-socket-scope.js /path/to/browser-client.mjs [--socket-dir-only]",
  );
}
const socketDirOnly = process.argv.includes("--socket-dir-only");

const socketDirMarker = "/*codexLinuxPerUserBrowserSocketDir*/";
const iabMarker = "/*codexLinuxIabSocketScope*/";
let source = fs.readFileSync(clientPath, "utf8");

if (!source.includes(socketDirMarker)) {
  const socketDirectoryPattern =
    /([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)=>\2==="win32"\?("(?:\\.|[^"\\])*codex-browser-use"):"\/tmp\/codex-browser-use"/g;
  const socketDirectoryMatches = [...source.matchAll(socketDirectoryPattern)];
  if (socketDirectoryMatches.length === 1) {
    const [target, resolver, platform, windowsSocket] = socketDirectoryMatches[0];
    const userInfoImport =
      'import{userInfo as codexLinuxBrowserUseUserInfo}from"node:os";';
    const helper =
      `function codexLinuxBrowserUseSocketDir(){let e=globalThis.nodeRepl?.env?.CODEX_BROWSER_USE_SOCKET_DIR;` +
      `if(typeof e==="string"&&e.length>0)return e;let t=codexLinuxBrowserUseUserInfo().uid;` +
      `if(Number.isInteger(t)&&t>=0)return \`/tmp/codex-browser-use-\${t}\`;` +
      `throw Error("Browser Use cannot resolve a per-user Linux socket directory")}${socketDirMarker}`;
    const replacement =
      `${resolver}=${platform}=>${platform}==="win32"?${windowsSocket}:codexLinuxBrowserUseSocketDir()`;
    source = userInfoImport + helper + source.replace(target, replacement);
  } else if (source.includes("/tmp/codex-browser-use")) {
    process.stderr.write(
      `WARN: Expected one Browser Use socket-directory resolver, found ${socketDirectoryMatches.length}; leaving its path unchanged\n`,
    );
  }
}

if (socketDirOnly || source.includes(iabMarker)) {
  fs.writeFileSync(clientPath, source, "utf8");
  process.exit(0);
}

const socketListingPattern =
  /([A-Za-z_$][\w$]*)=\(\)=>\s*([A-Za-z_$][\w$]*)\(\)==="win32"\?([A-Za-z_$][\w$]*)\(\):([A-Za-z_$][\w$]*)\(\),\4=async\(\)=>\(await ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\)\.map\(([A-Za-z_$][\w$]*)=>([A-Za-z_$][\w$]*)\.resolve\(\6,\7\)\),\3=async\(\)=>/g;
const matches = [...source.matchAll(socketListingPattern)];
if (matches.length !== 1) {
  if (source.includes("codex-browser-use")) {
    process.stderr.write(
      `WARN: Expected one IAB Browser socket listing target, found ${matches.length}; leaving IAB discovery unchanged\n`,
    );
  }
  fs.writeFileSync(clientPath, source, "utf8");
  process.exit(0);
}

const [
  target,
  dispatcher,
  platform,
  windowsListing,
  unixListing,
  readDirectory,
  socketDirectory,
  entry,
  pathModule,
] = matches[0];
const replacement =
  `${dispatcher}=()=>${platform}()==="win32"?${windowsListing}():${unixListing}(),` +
  `${unixListing}=async()=>(await ${readDirectory}(${socketDirectory}))` +
  `.filter(${entry}=>!${entry}.startsWith("extension-")${iabMarker})` +
  `.map(${entry}=>${pathModule}.resolve(${socketDirectory},${entry})),` +
  `${windowsListing}=async()=>`;
fs.writeFileSync(clientPath, source.replace(target, replacement), "utf8");
