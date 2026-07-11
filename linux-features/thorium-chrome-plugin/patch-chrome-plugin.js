#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function warn(message) {
  process.stderr.write(`WARN: ${message}\n`);
}

function sourceIncludesAny(source, texts) {
  return (Array.isArray(texts) ? texts : [texts]).some(
    (text) => typeof text === "string" && text.length > 0 && source.includes(text),
  );
}

function patchFile(filePath, patches) {
  let source;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    warn(`Could not read ${filePath}: ${error.message}`);
    return;
  }

  let changed = false;
  for (const { label, oldText, newText, alreadyText = newText } of patches) {
    if (source.includes(newText) || sourceIncludesAny(source, alreadyText)) {
      console.log(`${path.basename(filePath)} already patched: ${label}`);
      continue;
    }
    if (!source.includes(oldText)) {
      warn(`${path.basename(filePath)} missing patch target for ${label}`);
      continue;
    }
    source = source.replace(oldText, newText);
    changed = true;
    console.log(`Patched ${path.basename(filePath)}: ${label}`);
  }

  if (changed) {
    fs.writeFileSync(filePath, source, "utf8");
  }
}

function patchFileFirstMatch(filePath, { label, oldTexts, newText, alreadyText = newText }) {
  let source;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    warn(`Could not read ${filePath}: ${error.message}`);
    return;
  }

  if ((typeof newText === "string" && source.includes(newText)) || sourceIncludesAny(source, alreadyText)) {
    console.log(`${path.basename(filePath)} already patched: ${label}`);
    return;
  }

  const match = oldTexts
    .map((candidate) => typeof candidate === "string" ? { oldText: candidate, newText } : candidate)
    .find((candidate) => source.includes(candidate.oldText));
  if (!match) {
    warn(`${path.basename(filePath)} missing patch target for ${label}`);
    return;
  }

  fs.writeFileSync(filePath, source.replace(match.oldText, match.newText ?? newText), "utf8");
  console.log(`Patched ${path.basename(filePath)}: ${label}`);
}

const pluginDir = process.argv[2];
if (!pluginDir) {
  throw new Error("Usage: patch-chrome-plugin.js /path/to/chrome/plugin");
}

const scriptsDir = path.resolve(pluginDir, "scripts");

const nativeHostManifestFallback = `  if (process.platform === "linux") {
    const manifestPaths = [
      path.join(
        os.homedir(),
        ".config",
        "google-chrome",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      path.join(
        os.homedir(),
        ".config",
        "google-chrome-beta",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      path.join(
        os.homedir(),
        ".config",
        "google-chrome-unstable",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      path.join(
        os.homedir(),
        ".config",
        "BraveSoftware",
        "Brave-Browser",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      path.join(
        os.homedir(),
        ".config",
        "chromium",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
      path.join(
        os.homedir(),
        ".config",
        "thorium",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
    ];

    return {
      manifestPath:
        manifestPaths.find((candidate) => fs.existsSync(candidate)) ||
        manifestPaths[0],
      registryKey: null,
      registryManifestPath: null,
      registryKeyExists: null,
    };
  }`;

const nativeHostManifestFallbackWithoutThorium = nativeHostManifestFallback.replace(
  `      path.join(
        os.homedir(),
        ".config",
        "thorium",
        "NativeMessagingHosts",
        \`\${expectedHostName}.json\`,
      ),
`,
  "",
);

const extensionAwareUserDataFallback = `  const linuxChromeUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome");
  const linuxChromeBetaUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome-beta");
  const linuxChromeUnstableUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome-unstable");
  const linuxChromiumUserDataDirectory = path.join(os.homedir(), ".config", "chromium");
  const linuxThoriumUserDataDirectory = path.join(os.homedir(), ".config", "thorium");
  const linuxBraveUserDataDirectory = path.join(
    os.homedir(),
    ".config",
    "BraveSoftware",
    "Brave-Browser",
  );
  const linuxUserDataCandidates = [
    linuxBraveUserDataDirectory,
    linuxChromeUserDataDirectory,
    linuxChromeBetaUserDataDirectory,
    linuxChromeUnstableUserDataDirectory,
    linuxChromiumUserDataDirectory,
    linuxThoriumUserDataDirectory,
  ].filter((candidate) => fs.existsSync(candidate));
  const linuxCandidateWithInstalledExtension = linuxUserDataCandidates.find(
    (candidate) => {
      try {
        const extensionId = loadRemoteChromeExtensionId();
        return findLatestChromeProfile(candidate) != null &&
          fs.existsSync(
            path.join(
              candidate,
              resolveChromeProfileDirectory(candidate),
              "Extensions",
              extensionId,
            ),
          );
      } catch {
        return false;
      }
    },
  );
  if (linuxCandidateWithInstalledExtension) {
    return linuxCandidateWithInstalledExtension;
  }

  if (linuxUserDataCandidates.length > 0) return linuxUserDataCandidates[0];

  return linuxChromeUserDataDirectory;`;

const extensionAwareUserDataFallbackWithoutThorium = extensionAwareUserDataFallback
  .replace('  const linuxThoriumUserDataDirectory = path.join(os.homedir(), ".config", "thorium");\n', "")
  .replace("    linuxThoriumUserDataDirectory,\n", "");

const defaultBrowserUserDataFallback = `  const linuxChromeUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome");
  const linuxChromeBetaUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome-beta");
  const linuxChromeUnstableUserDataDirectory = path.join(os.homedir(), ".config", "google-chrome-unstable");
  const linuxChromiumUserDataDirectory = path.join(os.homedir(), ".config", "chromium");
  const linuxThoriumUserDataDirectory = path.join(os.homedir(), ".config", "thorium");
  const linuxBraveUserDataDirectory = path.join(
    os.homedir(),
    ".config",
    "BraveSoftware",
    "Brave-Browser",
  );
  const defaultBrowser = runCommand(["xdg-settings", "get", "default-web-browser"]);
  if (
    defaultBrowser === "brave-browser.desktop" &&
    fs.existsSync(linuxBraveUserDataDirectory)
  ) {
    return linuxBraveUserDataDirectory;
  }
  if (
    defaultBrowser === "google-chrome-beta.desktop" &&
    fs.existsSync(linuxChromeBetaUserDataDirectory)
  ) {
    return linuxChromeBetaUserDataDirectory;
  }
  if (
    defaultBrowser === "google-chrome-unstable.desktop" &&
    fs.existsSync(linuxChromeUnstableUserDataDirectory)
  ) {
    return linuxChromeUnstableUserDataDirectory;
  }
  if (
    ["chromium.desktop", "chromium-browser.desktop"].includes(defaultBrowser) &&
    fs.existsSync(linuxChromiumUserDataDirectory)
  ) {
    return linuxChromiumUserDataDirectory;
  }
  if (
    ["thorium-browser.desktop", "thorium-browser-avx2.desktop"].includes(defaultBrowser) &&
    fs.existsSync(linuxThoriumUserDataDirectory)
  ) {
    return linuxThoriumUserDataDirectory;
  }

  if (fs.existsSync(linuxBraveUserDataDirectory)) return linuxBraveUserDataDirectory;
  if (fs.existsSync(linuxChromeUserDataDirectory)) return linuxChromeUserDataDirectory;
  if (fs.existsSync(linuxChromeBetaUserDataDirectory)) return linuxChromeBetaUserDataDirectory;
  if (fs.existsSync(linuxChromeUnstableUserDataDirectory)) return linuxChromeUnstableUserDataDirectory;
  if (fs.existsSync(linuxChromiumUserDataDirectory)) return linuxChromiumUserDataDirectory;
  if (fs.existsSync(linuxThoriumUserDataDirectory)) return linuxThoriumUserDataDirectory;

  return linuxChromeUserDataDirectory;`;

const defaultBrowserUserDataFallbackWithoutThorium = defaultBrowserUserDataFallback
  .replace('  const linuxThoriumUserDataDirectory = path.join(os.homedir(), ".config", "thorium");\n', "")
  .replace(`  if (
    ["thorium-browser.desktop", "thorium-browser-avx2.desktop"].includes(defaultBrowser) &&
    fs.existsSync(linuxThoriumUserDataDirectory)
  ) {
    return linuxThoriumUserDataDirectory;
  }
`, "")
  .replace("  if (fs.existsSync(linuxThoriumUserDataDirectory)) return linuxThoriumUserDataDirectory;\n", "");

patchFileFirstMatch(path.join(scriptsDir, "installManifest.mjs"), {
  label: "Thorium native host manifest location",
  oldTexts: [
    'linux:[".config/google-chrome/NativeMessagingHosts",".config/google-chrome-beta/NativeMessagingHosts",".config/google-chrome-unstable/NativeMessagingHosts",".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",".config/chromium/NativeMessagingHosts"]',
  ],
  newText:
    'linux:[".config/google-chrome/NativeMessagingHosts",".config/google-chrome-beta/NativeMessagingHosts",".config/google-chrome-unstable/NativeMessagingHosts",".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",".config/chromium/NativeMessagingHosts",".config/thorium/NativeMessagingHosts"]',
});

patchFile(path.join(scriptsDir, "check-native-host-manifest.js"), [
  {
    label: "Thorium native host manifest fallback",
    oldText: nativeHostManifestFallbackWithoutThorium,
    newText: nativeHostManifestFallback,
    alreadyText: '"thorium",\n        "NativeMessagingHosts"',
  },
]);

patchFile(path.join(scriptsDir, "installed-browsers.js"), [
  {
    label: "Thorium browser inventory",
    oldText: `  {
    name: "Chromium",
    bundleIds: ["org.chromium.Chromium"],
    appNames: ["Chromium.app"],
    commands: ["chromium", "chromium-browser"],
    windowsExecutable: "chrome.exe",
  },
];`,
    newText: `  {
    name: "Chromium",
    bundleIds: ["org.chromium.Chromium"],
    appNames: ["Chromium.app"],
    commands: ["chromium", "chromium-browser"],
    windowsExecutable: "chrome.exe",
  },
  {
    name: "Thorium",
    bundleIds: ["org.chromium.Thorium"],
    appNames: ["Thorium.app"],
    commands: ["thorium-browser-avx2", "thorium-browser", "thorium"],
    windowsExecutable: "chrome.exe",
  },
];`,
    alreadyText: '"Thorium"',
  },
]);

patchFileFirstMatch(path.join(scriptsDir, "chrome-is-running.js"), {
  label: "Thorium running-process detection",
  oldTexts: [
    `  linux: new Set(["chrome", "google-chrome", "google-chrome-beta", "google-chrome-unstable", "brave", "brave-browser", "chromium", "chromium-browser"]),`,
  ],
  newText: `  linux: new Set(["chrome", "google-chrome", "google-chrome-beta", "google-chrome-unstable", "brave", "brave-browser", "chromium", "chromium-browser", "thorium", "thorium-browser", "thorium-browser-avx2"]),`,
  alreadyText: "thorium-browser-avx2",
});

patchFileFirstMatch(path.join(scriptsDir, "check-extension-installed.js"), {
  label: "Thorium extension-aware browser profile fallback",
  oldTexts: [extensionAwareUserDataFallbackWithoutThorium],
  newText: extensionAwareUserDataFallback,
  alreadyText: "linuxThoriumUserDataDirectory",
});

patchFileFirstMatch(path.join(scriptsDir, "open-chrome-window.js"), {
  label: "Thorium default-browser profile fallback",
  oldTexts: [defaultBrowserUserDataFallbackWithoutThorium],
  newText: defaultBrowserUserDataFallback,
  alreadyText: "linuxThoriumUserDataDirectory",
});

patchFile(path.join(scriptsDir, "open-chrome-window.js"), [
  {
    label: "Thorium browser window command",
    oldText: `  } else if (linuxUserDataDirectory.includes(path.join(".config", "chromium"))) {
    linuxCommand = commandPath("chromium") || commandPath("chromium-browser") || "chromium";
  }

  return {`,
    newText: `  } else if (linuxUserDataDirectory.includes(path.join(".config", "chromium"))) {
    linuxCommand = commandPath("chromium") || commandPath("chromium-browser") || "chromium";
  } else if (linuxUserDataDirectory.includes(path.join(".config", "thorium"))) {
    linuxCommand = commandPath("thorium-browser-avx2") || commandPath("thorium-browser") || commandPath("thorium") || "thorium-browser";
  }

  return {`,
    alreadyText: 'commandPath("thorium-browser-avx2")',
  },
]);
