import { LocalModule } from "../local-module";
import { getStateManager } from "../module-state-manager";
import { PublishDependenciesSubset } from "../subsets/publish-dependencies-subset";
import { buildModuleIfChanged } from "../build";
import { NpmViewInfo, setPackageVersion } from "./npm-view";
import * as prompts from "prompts";
import { shutdown } from "../shutdown";
import { NpmRunner } from "../module-npm-runner";
import * as path from "path";
import * as fs from "fs-extra";
import * as semver from "semver";
import { getNpmInfoReader } from "../npm-info-reader";
import { getPackageReader } from "../package-reader";
import { BuildDependenciesSubset } from "../subsets/build-dependencies-subset";


async function arePublishDepsChanged(mod: LocalModule) {
  let stateManager = getStateManager();
  let subset = new PublishDependenciesSubset(mod);
  return stateManager.isSubsetChanged(mod, subset.getName(), subset);
}


async function needsPublish(mod: LocalModule) {
  if (!mod.useNpm) {
    return false;
  }

  let wasBuilt = await buildModuleIfChanged(mod);

  let publishDepsChanged = wasBuilt;
  if (!wasBuilt) {
    publishDepsChanged = await arePublishDepsChanged(mod);
  }

  let result = wasBuilt || publishDepsChanged;

  let info: NpmViewInfo | undefined;
  if (!result) {
    info = await getNpmInfoReader().getNpmInfo(mod);
    if (!info.isCurrentVersionPublished) {
      const answer = await prompts({
        type: "confirm",
        name: "shouldPublish",
        message: `Current version of module "${ mod.checkedName.name }" (${ info.currentVersion }) is not yet published on npm registry. Publish now?`,
        initial: true
      });

      if (answer.shouldPublish !== true) {
        shutdown(-1);
      }

      result = true;
    }
  }

  return result;
}

function getOptionVersion(version: string, release: semver.ReleaseType): string | undefined {
  return semver.inc(version, release) || undefined;
}

let prevSelectedRelease: number | undefined;

let releaseChoices: semver.ReleaseType[] = [ "major", "premajor", "minor", "preminor", "patch", "prepatch" ];

function startSyncSemver(cv: semver.SemVer): string {
  return `${ cv.major }.${ cv.minor }.${ cv.patch }-dev.${ 1 }`;
}

function getNewVersionFrom(currentVersion: string): string {
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

  ++syncID;

  return `${ cv.major }.${ cv.minor }.${ cv.patch }-dev.${ syncID }`;
}

async function getNewVersion(mod: LocalModule, text?: string): Promise<string> {
  let response = await prompts({
    type: "text",
    name: "version",
    message: text || `Module "${ mod.checkedName.name }" has no version set in package.json. Please set its version: `
  });

  let version = response.version;
  if (!version) {
    shutdown(-1);
  }

  return version;
}

async function publishModule(mod: LocalModule): Promise<{ publishedVersion: string; versionChanged: boolean }> {
  let publishedVersion: string | undefined;

  let info = await getNpmInfoReader().getNpmInfo(mod);

  let versionChanged = false;
  if (info.isCurrentVersionPublished || !info.currentVersion) {
    let newVersion = info.currentVersion ? getNewVersionFrom(info.currentVersion) : await getNewVersion(mod);
    await setPackageVersion(mod, newVersion);
    versionChanged = true;
    publishedVersion = newVersion;
  } else if (!info.isOnRegistry) {
    publishedVersion = info.currentVersion;
    console.log(`Module "${ mod.checkedName.name }" is not yet published on npm registry.`);
  } else {
    publishedVersion = info.currentVersion;
    console.log(`Version ${ info.currentVersion } of module "${ mod.checkedName.name }" is not yet published on npm registry`);
  }

  let ignoreCopied = false;
  let outsideIgnore = mod.outsideIgnoreFilePath;
  let insideIgnore = path.join(mod.path, ".npmignore");
  if (outsideIgnore) {
    fs.copyFileSync(outsideIgnore, insideIgnore);
    ignoreCopied = true;
  }

  try {
    await NpmRunner.run(mod, [ "publish" ]);
  } finally {
    getNpmInfoReader().invalidate(mod);

    if (ignoreCopied) {
      fs.unlinkSync(insideIgnore);
    }
  }

  let stateManager = getStateManager();
  let subset = new PublishDependenciesSubset(mod);
  stateManager.saveState(mod, subset.getName(), await stateManager.getActualState(mod));

  return {
    publishedVersion,
    versionChanged
  };
}


/**
 * Publishes module if any publish dependencies are changed since last publish.
 * Returns updated version of this module if module was published.
 * Returns undefined if module was not published.
 */
export async function publishModuleIfChanged(mod: LocalModule): Promise<string | undefined> {
  if (await needsPublish(mod)) {
    let publishResult = await publishModule(mod);
    if (publishResult.versionChanged) {
      // update module state
      let packageJSONPath = getPackageReader().getPackageMetadataPath(mod.path);
      let stateManager = getStateManager();
      stateManager.updateFileState(mod, PublishDependenciesSubset.getTag(), packageJSONPath);
      stateManager.updateFileState(mod, BuildDependenciesSubset.getTag(), packageJSONPath);
    }

    return publishResult.publishedVersion;
  }

  return undefined;
}
