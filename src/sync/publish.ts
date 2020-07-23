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

async function getVersionForPublish(mod: LocalModule): Promise<{ version: string; shouldChange: boolean }> {
  let info = await getNpmInfoReader().getNpmInfo(mod);
  if (info.isCurrentVersionPublished || !info.currentVersion) {
    if (!info.currentVersion) {
      throw new Error(`No version set in package.json: "${ mod.name }"`);
    }

    return {
      version: getNextSyncVersion(info.currentVersion),
      shouldChange: true
    };
  } else if (!info.isOnRegistry) {
    console.log(`Module "${ mod.checkedName.name }" is not yet published on npm registry.`);
    return {
      version: info.currentVersion,
      shouldChange: false
    };
  } else {
    console.log(`Version ${ info.currentVersion } of module "${ mod.checkedName.name }" is not yet published on npm registry`);
    return {
      version: info.currentVersion,
      shouldChange: false
    };
  }
}

async function publishModule(mod: LocalModule): Promise<string> {
  let publishVersion = await getVersionForPublish(mod);
  if (publishVersion.shouldChange) {
    await setPackageVersion(mod, publishVersion.version);
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
  if (publishVersion.shouldChange) {
    stateManager.updateFileState(mod, BuildDependenciesSubset.getTag(), getPackageReader().getPackageMetadataPath(mod.path));
  }

  return publishVersion.version;
}


/**
 * Builds and publishes module if something is changed inside the module.
 * Returns updated version of this module if module was published.
 * Returns undefined if module was not published.
 */
export async function publishModuleIfChanged(mod: LocalModule): Promise<string | undefined> {
  if (await buildModuleAndCheckItNeedsPublish(mod)) {
    return publishModule(mod);
  }

  return undefined;
}
