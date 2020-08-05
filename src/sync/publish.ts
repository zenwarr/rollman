import { LocalModule } from "../local-module";
import { getStateManager } from "../module-state-manager";
import { PublishDependenciesSubset } from "../subsets/publish-dependencies-subset";
import { buildModuleIfChanged } from "../build";
import { NpmRunner } from "../module-npm-runner";
import * as path from "path";
import * as fs from "fs-extra";
import * as semver from "semver";
import { getNpmInfoReader } from "../npm-info-reader";
import { getPackageReader } from "../package-reader";
import { BuildDependenciesSubset } from "../subsets/build-dependencies-subset";
import { setPackageVersion } from "./npm-view";
import { ReleaseType } from "../release/release-types";


async function arePublishDepsChanged(mod: LocalModule) {
  let stateManager = getStateManager();
  let subset = new PublishDependenciesSubset(mod);
  return stateManager.isSubsetChanged(mod, subset.getName(), subset);
}


async function buildModuleAndCheckItNeedsPublish(mod: LocalModule): Promise<boolean> {
  if (!mod.useNpm || !mod.publish) {
    return false;
  }

  if (await buildModuleIfChanged(mod)) {
    return true;
  }

  if (await arePublishDepsChanged(mod)) {
    return true;
  }

  if (!(await getNpmInfoReader().getNpmInfo(mod)).isCurrentVersionPublished) {
    return true;
  }

  return false;
}


function startSyncSemver(cv: semver.SemVer): string {
  return `${ cv.major }.${ cv.minor }.${ cv.patch + 1 }-dev.${ 1 }`;
}

function getNextSyncVersion(currentVersion: string): string {
  let cv = semver.parse(currentVersion);
  if (!cv) {
    throw new Error(`Cannot parse semver: "${ currentVersion }"`);
  }

  if (cv.prerelease.length !== 2 || cv.prerelease[0] !== "dev") {
    return startSyncSemver(cv);
  }

  let syncID = +cv.prerelease[1];
  if (isNaN(syncID)) {
    return startSyncSemver(cv);
  }

  return `${ cv.major }.${ cv.minor }.${ cv.patch }-dev.${ ++syncID }`;
}

function isSyncVersion(version: string): boolean {
  let parsed = semver.parse(version);
  if (!parsed) {
    throw new Error(`Invalid semver version: "${ parsed }"`);
  }

  return parsed.prerelease.length === 2 && parsed.prerelease[0] === "dev" && !isNaN(+parsed.prerelease[1]);
}

async function getVersionForSync(mod: LocalModule): Promise<string> {
  let info = await getNpmInfoReader().getNpmInfo(mod);
  if (info.isCurrentVersionPublished || !info.currentVersion) {
    if (!info.currentVersion) {
      throw new Error(`No version set in package.json: "${ mod.name }"`);
    }

    return getNextSyncVersion(info.currentVersion);
  } else if (!info.isOnRegistry) {
    console.log(`Module "${ mod.checkedName.name }" is not yet published on npm registry.`);
    return info.currentVersion;
  } else {
    console.log(`Version ${ info.currentVersion } of module "${ mod.checkedName.name }" is not yet published on npm registry`);
    return info.currentVersion;
  }
}

async function getVersionForRelease(mod: LocalModule, releaseType: ReleaseType): Promise<string> {
  let currentVersion: string | undefined = (await getPackageReader().readPackageMetadata(mod.path)).version;
  if (!currentVersion) {
    throw new Error(`Module "${ mod.checkedName.name }" has no version set in package.json`);
  }

  let newVersion = semver.inc(currentVersion, releaseType);
  if (!newVersion) {
    throw new Error(`Failed to get release "${ releaseType }" version for module "${ mod.checkedName.name }"`);
  }

  return newVersion;
}

async function publishModule(mod: LocalModule, version: string): Promise<void> {
  let versionChanged = false;
  let npmInfo = await getNpmInfoReader().getNpmInfo(mod);
  if (npmInfo.currentVersion !== version) {
    await setPackageVersion(mod, version);
    versionChanged = true;
  }

  let isIgnoreCopied = false;
  let outsideIgnore = mod.outsideIgnoreFilePath;
  let insideIgnore = path.join(mod.path, ".npmignore");
  if (outsideIgnore) {
    fs.copyFileSync(outsideIgnore, insideIgnore);
    isIgnoreCopied = true;
  }

  try {
    await NpmRunner.run(mod, [ "publish" ]);
  } finally {
    getNpmInfoReader().invalidate(mod);

    if (isIgnoreCopied) {
      fs.unlinkSync(insideIgnore);
    }
  }

  let stateManager = getStateManager();
  stateManager.saveState(mod, PublishDependenciesSubset.getTag(), await stateManager.getActualState(mod));
  if (versionChanged) {
    stateManager.updateFileState(mod, BuildDependenciesSubset.getTag(), getPackageReader().getPackageMetadataPath(mod.path));
  }
}


/**
 * Builds and publishes module if something is changed inside the module.
 * Returns updated version of this module if module was published.
 * Returns undefined if module was not published.
 */
export async function publishModuleForSync(mod: LocalModule): Promise<string | undefined> {
  if (await buildModuleAndCheckItNeedsPublish(mod)) {
    let syncVersion = await getVersionForSync(mod);
    await publishModule(mod, syncVersion);
    return syncVersion;
  }

  return undefined;
}


export async function publishModuleForFetch(mod: LocalModule): Promise<void> {
  if (!mod.useNpm) {
    return;
  }

  let currentVersion = (await getPackageReader().readPackageMetadata(mod.path)).version;
  if (!currentVersion) {
    return;
  }

  let npmInfo = await getNpmInfoReader().getNpmInfo(mod);
  let isPublished = npmInfo.publishedVersions.includes(currentVersion);
  if (!isPublished) {
    await publishModule(mod, currentVersion);
  }
}


export async function publishModuleForRelease(mod: LocalModule, releaseType: ReleaseType): Promise<string | undefined> {
  let shouldPublish = await buildModuleAndCheckItNeedsPublish(mod);
  if (!shouldPublish) {
    let currentVersion: string | undefined = getPackageReader().readPackageMetadata(mod.path).version;
    if (!currentVersion) {
      throw new Error(`Module "${ mod.checkedName.name }" has no version set in package.json`);
    }

    if (!isSyncVersion(currentVersion)) {
      return undefined;
    }
  }

  let newVersion = await getVersionForRelease(mod, releaseType);
  await publishModule(mod, newVersion);
  return newVersion;
}
