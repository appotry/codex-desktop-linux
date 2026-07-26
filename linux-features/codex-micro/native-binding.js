#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SUPPORTED_ARCHITECTURES = new Set(["x64", "arm64"]);

function digest(contents, algorithm, encoding) {
  return crypto.createHash(algorithm).update(contents).digest(encoding);
}

function integrityFor(contents) {
  return `sha512-${digest(contents, "sha512", "base64")}`;
}

function readPackageMetadata(packageDir, label) {
  const packagePath = path.join(packageDir, "package.json");
  const stat = fs.lstatSync(packagePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} package.json is missing or unsafe: ${packagePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} package.json is unreadable: ${error.message}`);
  }
}

function requirePackageDirectory(packageDir, expectedName, label) {
  const stat = fs.lstatSync(packageDir, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} package is missing or unsafe: ${packageDir}`);
  }
  const metadata = readPackageMetadata(packageDir, label);
  if (metadata.name !== expectedName) {
    throw new Error(
      `${label} package identity mismatch: expected ${expectedName}, got ${metadata.name ?? "unknown"}`,
    );
  }
  return metadata;
}

function discoverBundledNodeHid(extractedDir) {
  const extractedRoot = path.resolve(extractedDir);
  const deviceKitDir = path.join(
    extractedRoot,
    "node_modules",
    "@worklouder",
    "device-kit-oai",
  );
  assertNoSymbolicLinkAncestors(extractedRoot, deviceKitDir);
  requirePackageDirectory(deviceKitDir, "@worklouder/device-kit-oai", "Work Louder device-kit-oai");

  const workLouderKitDir = path.join(
    deviceKitDir,
    "node_modules",
    "@worklouder",
    "wl-device-kit",
  );
  assertNoSymbolicLinkAncestors(extractedRoot, workLouderKitDir);
  requirePackageDirectory(
    workLouderKitDir,
    "@worklouder/wl-device-kit",
    "Work Louder wl-device-kit",
  );

  const nodeHidDir = path.join(workLouderKitDir, "node_modules", "node-hid");
  assertNoSymbolicLinkAncestors(extractedRoot, nodeHidDir);
  const nodeHid = requirePackageDirectory(
    nodeHidDir,
    "node-hid",
    "Work Louder nested node-hid",
  );
  return {
    deviceKitDir,
    workLouderKitDir,
    nodeHidDir,
    packageMetadata: nodeHid,
    name: nodeHid.name,
    version: nodeHid.version,
    license: nodeHid.license,
  };
}

function normalizeArchitecture(arch) {
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`Unsupported Codex Micro native binding architecture: ${String(arch)}`);
  }
  return arch;
}

function selectPrebuild(artifactManifest, arch) {
  normalizeArchitecture(arch);
  return artifactManifest?.prebuilds?.[arch] ?? null;
}

function inspectElf(contents) {
  if (
    !Buffer.isBuffer(contents)
    || contents.length < 20
    || !contents.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  ) {
    throw new Error("Native binding is not an ELF binary");
  }
  if (contents[4] !== 2) {
    throw new Error(`Unsupported ELF class ${contents[4]}; expected a 64-bit ELF binary`);
  }
  if (contents[5] !== 1) {
    throw new Error(`Unsupported ELF encoding ${contents[5]}; expected little-endian`);
  }
  const machine = contents.readUInt16LE(18);
  const arch = machine === 62 ? "x64" : machine === 183 ? "arm64" : null;
  if (arch == null) {
    throw new Error(`Unsupported ELF machine ${machine}`);
  }
  return { arch, machine };
}

function safeRelativeFilePath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || path.isAbsolute(value)
    || value.split(/[\\/]+/).some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a safe relative file path`);
  }
  return value;
}

function validateArtifactManifest(artifactManifest) {
  if (
    artifactManifest == null
    || typeof artifactManifest !== "object"
    || Array.isArray(artifactManifest)
  ) {
    throw new Error("Codex Micro node-hid artifact manifest is invalid");
  }
  for (const key of ["name", "version", "license", "integrity", "shasum"]) {
    if (typeof artifactManifest[key] !== "string" || artifactManifest[key].length === 0) {
      throw new Error(`Codex Micro node-hid artifact manifest is missing ${key}`);
    }
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(artifactManifest.integrity)) {
    throw new Error("Codex Micro node-hid artifact integrity is invalid");
  }
  if (!/^[0-9a-f]{40}$/.test(artifactManifest.shasum)) {
    throw new Error("Codex Micro node-hid artifact shasum is invalid");
  }

  const loaderContract = artifactManifest.loaderContract;
  if (
    loaderContract == null
    || typeof loaderContract !== "object"
    || Array.isArray(loaderContract)
    || typeof loaderContract.main !== "string"
    || !Array.isArray(loaderContract.napiVersions)
    || loaderContract.napiVersions.length === 0
    || !loaderContract.napiVersions.every(Number.isSafeInteger)
    || loaderContract.files == null
    || typeof loaderContract.files !== "object"
    || Array.isArray(loaderContract.files)
    || Object.keys(loaderContract.files).length === 0
  ) {
    throw new Error("Codex Micro node-hid loader contract is invalid");
  }
  for (const [relativePath, sha256] of Object.entries(loaderContract.files)) {
    safeRelativeFilePath(relativePath, "Codex Micro node-hid loader contract file");
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`Codex Micro node-hid loader contract hash is invalid: ${relativePath}`);
    }
  }

  for (const arch of SUPPORTED_ARCHITECTURES) {
    const prebuild = artifactManifest.prebuilds?.[arch];
    if (prebuild == null || typeof prebuild !== "object" || Array.isArray(prebuild)) {
      throw new Error(`Codex Micro node-hid artifact manifest is missing the ${arch} prebuild`);
    }
    const expectedPath = `prebuilds/HID_hidraw-linux-${arch}/node-napi-v4.node`;
    if (safeRelativeFilePath(prebuild.path, `Codex Micro ${arch} prebuild path`) !== expectedPath) {
      throw new Error(`Codex Micro ${arch} prebuild path must be ${expectedPath}`);
    }
    if (typeof prebuild.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(prebuild.sha256)) {
      throw new Error(`Codex Micro ${arch} prebuild SHA-256 is invalid`);
    }
  }
}

function validateBundledPackage(discovered, artifactManifest) {
  if (discovered.name !== artifactManifest.name) {
    throw new Error(
      `Bundled node-hid identity mismatch: expected ${artifactManifest.name}, got ${discovered.name}`,
    );
  }
  if (discovered.version !== artifactManifest.version) {
    throw new Error(
      `Bundled node-hid version mismatch: expected ${artifactManifest.version}, got ${discovered.version}`,
    );
  }
  if (discovered.license !== artifactManifest.license) {
    throw new Error(
      `Bundled node-hid license mismatch: expected ${artifactManifest.license}, got ${discovered.license}`,
    );
  }

  const loaderContract = artifactManifest.loaderContract;
  if (discovered.packageMetadata.main !== loaderContract.main) {
    throw new Error(
      `Bundled node-hid loader entrypoint mismatch: expected ${loaderContract.main}, ` +
        `got ${discovered.packageMetadata.main ?? "unknown"}`,
    );
  }
  if (
    JSON.stringify(discovered.packageMetadata.binary?.napi_versions)
    !== JSON.stringify(loaderContract.napiVersions)
  ) {
    throw new Error(
      `Bundled node-hid N-API contract mismatch: expected ` +
        `${JSON.stringify(loaderContract.napiVersions)}, got ` +
        `${JSON.stringify(discovered.packageMetadata.binary?.napi_versions ?? null)}`,
    );
  }
  for (const [relativePath, expectedSha256] of Object.entries(loaderContract.files)) {
    const filePath = path.join(discovered.nodeHidDir, relativePath);
    assertNoSymbolicLinkAncestors(discovered.nodeHidDir, filePath);
    const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Bundled node-hid loader contract file is missing or unsafe: ${relativePath}`);
    }
    const actualSha256 = digest(fs.readFileSync(filePath), "sha256", "hex");
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `Bundled node-hid loader contract hash mismatch for ${relativePath}: ` +
          `expected ${expectedSha256}, got ${actualSha256}`,
      );
    }
  }
}

function validateMaterializedPackage(materialized, artifactManifest) {
  if (materialized == null || typeof materialized !== "object") {
    throw new Error("node-hid materializer returned no package");
  }
  if (materialized.integrity !== artifactManifest.integrity) {
    throw new Error(
      `node-hid artifact integrity mismatch: expected ${artifactManifest.integrity}, ` +
        `got ${materialized.integrity ?? "unknown"}`,
    );
  }
  if (materialized.shasum !== artifactManifest.shasum) {
    throw new Error(
      `node-hid artifact shasum mismatch: expected ${artifactManifest.shasum}, ` +
        `got ${materialized.shasum ?? "unknown"}`,
    );
  }
  const metadata = readPackageMetadata(materialized.packageDir, "Materialized node-hid");
  for (const key of ["name", "version", "license"]) {
    if (metadata[key] !== artifactManifest[key]) {
      throw new Error(
        `node-hid artifact ${key} mismatch: expected ${artifactManifest[key]}, ` +
          `got ${metadata[key] ?? "unknown"}`,
      );
    }
  }
}

function validateBinding(contents, expectedArch, expectedSha256) {
  const actualSha256 = digest(contents, "sha256", "hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `node-hid native binding SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  const elf = inspectElf(contents);
  if (elf.arch !== expectedArch) {
    throw new Error(
      `node-hid native binding ELF architecture ${elf.arch} does not match ${expectedArch}`,
    );
  }
  return elf;
}

function assertNoSymbolicLinkAncestors(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rootStat = fs.lstatSync(resolvedRoot, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Codex Micro native binding root must be a safe directory: ${resolvedRoot}`);
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (
    relative === ""
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`Codex Micro native binding target must stay inside ${resolvedRoot}`);
  }

  let current = resolvedRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) {
      throw new Error(`Codex Micro native binding path must not contain symlinks: ${current}`);
    }
  }
}

function atomicWriteBinding(nodeHidDir, targetPath, contents) {
  assertNoSymbolicLinkAncestors(nodeHidDir, targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  assertNoSymbolicLinkAncestors(nodeHidDir, targetPath);
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.codex-micro-${process.pid}-` +
      crypto.randomBytes(8).toString("hex"),
  );
  let temporaryFd;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    temporaryFd = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | noFollow,
      0o755,
    );
    fs.writeFileSync(temporaryFd, contents);
    fs.fchmodSync(temporaryFd, 0o755);
    fs.closeSync(temporaryFd);
    temporaryFd = undefined;
    assertNoSymbolicLinkAncestors(nodeHidDir, targetPath);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (temporaryFd != null) {
      fs.closeSync(temporaryFd);
    }
    fs.rmSync(temporaryPath, { force: true });
  }
}

function run(command, args, options = {}) {
  try {
    return childProcess.execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const failure = stderr || error?.code || error?.message || "unknown error";
    throw new Error(`${command} ${args.join(" ")} failed: ${failure}`);
  }
}

async function defaultMaterializePackage(request) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-micro-node-hid-"));
  try {
    const archiveOverride = process.env.CODEX_MICRO_NODE_HID_ARCHIVE?.trim();
    let archivePath;
    if (archiveOverride) {
      archivePath = path.resolve(archiveOverride);
      const stat = fs.lstatSync(archivePath, { throwIfNoEntry: false });
      if (!stat?.isFile() || stat.isSymbolicLink()) {
        throw new Error(`CODEX_MICRO_NODE_HID_ARCHIVE is not a safe file: ${archivePath}`);
      }
    } else {
      const packOutput = run(
        "npm",
        [
          "pack",
          `${request.name}@${request.version}`,
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          temporaryRoot,
        ],
        { env: { ...process.env, npm_config_ignore_scripts: "true" } },
      );
      let packResult;
      try {
        [packResult] = JSON.parse(packOutput);
      } catch (error) {
        throw new Error(`Could not parse npm pack output: ${error.message}`);
      }
      archivePath = path.join(temporaryRoot, packResult.filename);
    }

    const archive = fs.readFileSync(archivePath);
    const integrity = integrityFor(archive);
    const shasum = digest(archive, "sha1", "hex");
    if (integrity !== request.integrity || shasum !== request.shasum) {
      throw new Error(
        `node-hid archive verification failed: expected ${request.integrity} / ` +
          `${request.shasum}, got ${integrity} / ${shasum}`,
      );
    }

    const extractRoot = path.join(temporaryRoot, "extracted");
    fs.mkdirSync(extractRoot);
    run("tar", ["-xzf", archivePath, "-C", extractRoot]);
    const packageDir = path.join(extractRoot, "package");
    const stat = fs.lstatSync(packageDir, { throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("node-hid archive did not contain a safe package/ directory");
    }
    return {
      packageDir,
      integrity,
      shasum,
      cleanup: () => fs.rmSync(temporaryRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function stageCodexMicroNativeBinding(options) {
  const arch = normalizeArchitecture(options.arch);
  const artifactManifest = options.artifactManifest;
  const materializePackage = options.materializePackage ?? defaultMaterializePackage;
  validateArtifactManifest(artifactManifest);

  const discovered = discoverBundledNodeHid(options.extractedDir);
  validateBundledPackage(discovered, artifactManifest);

  const prebuild = selectPrebuild(artifactManifest, arch);
  if (prebuild == null) {
    throw new Error(`A verified node-hid prebuild is required for ${arch}`);
  }
  const targetPath = path.join(discovered.nodeHidDir, prebuild.path);
  assertNoSymbolicLinkAncestors(path.resolve(options.extractedDir), targetPath);
  const existingStat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
  if (existingStat != null) {
    if (!existingStat.isFile() || existingStat.isSymbolicLink()) {
      throw new Error(`Existing node-hid native binding is unsafe: ${targetPath}`);
    }
    const existing = fs.readFileSync(targetPath);
    const existingSha256 = digest(existing, "sha256", "hex");
    if (existingSha256 !== prebuild.sha256) {
      throw new Error(
        `Existing node-hid native binding hash mismatch: expected ${prebuild.sha256}, ` +
        `got ${existingSha256}`,
      );
    }
    validateBinding(existing, arch, prebuild.sha256);
    return {
      changed: false,
      alreadyApplied: true,
      version: artifactManifest.version,
      targetPath,
      source: "existing-prebuild",
      integrity: artifactManifest.integrity,
    };
  }

  let materialized;
  try {
    materialized = await materializePackage({
      name: artifactManifest.name,
      version: artifactManifest.version,
      integrity: artifactManifest.integrity,
      shasum: artifactManifest.shasum,
    });
    validateMaterializedPackage(materialized, artifactManifest);

    const sourcePath = path.join(materialized.packageDir, prebuild.path);
    assertNoSymbolicLinkAncestors(materialized.packageDir, sourcePath);
    const sourceStat = fs.lstatSync(sourcePath, { throwIfNoEntry: false });
    if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Verified node-hid prebuild is missing or unsafe: ${prebuild.path}`);
    }
    const contents = fs.readFileSync(sourcePath);
    validateBinding(contents, arch, prebuild.sha256);
    atomicWriteBinding(path.resolve(options.extractedDir), targetPath, contents);

    return {
      changed: true,
      alreadyApplied: false,
      version: artifactManifest.version,
      targetPath,
      source: "verified-prebuild",
      integrity: artifactManifest.integrity,
    };
  } finally {
    materialized?.cleanup?.();
  }
}

function currentArtifactManifest() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "native-artifacts.json"), "utf8"),
  );
}

async function main() {
  if (process.argv[2] !== "--stage" || !process.argv[3]) {
    console.error("Usage: native-binding.js --stage <extracted-app-dir>");
    process.exitCode = 1;
    return;
  }
  const result = await stageCodexMicroNativeBinding({
    extractedDir: process.argv[3],
    arch: process.arch,
    artifactManifest: currentArtifactManifest(),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  defaultMaterializePackage,
  discoverBundledNodeHid,
  inspectElf,
  selectPrebuild,
  stageCodexMicroNativeBinding,
  validateArtifactManifest,
};
