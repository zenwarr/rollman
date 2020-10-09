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


async function unpublishModule(mod: LocalModule, version: string): Promise<void> {
  let result = await NpmRunner.getOutput(mod, [ "unpublish", "--json", `${ mod.checkedName.name }@${ version }` ], {
    ignoreExitCode: true
  });
  if (!result) {
    return;
  }

  let parsedResult;
  try {
    parsedResult = JSON.parse(result);
  } catch (error) {
    return;
  }

  if (parsedResult.error && parsedResult.error.code === "E404") {
    return;
  }

  throw new Error(result);
}


async function publishModule(mod: LocalModule): Promise<void> {
  let npmInfo = await getNpmInfoReader().getNpmInfo(mod);

  let isIgnoreCopied = false;
  let outsideIgnore = mod.outsideIgnoreFilePath;
  let insideIgnore = path.join(mod.path, ".npmignore");
  if (outsideIgnore && !fs.existsSync(insideIgnore)) {
    fs.copyFileSync(outsideIgnore, insideIgnore);
    isIgnoreCopied = true;
  }

  try {
    if (npmInfo.currentVersion && npmInfo.publishedVersions.includes(npmInfo.currentVersion)) {
      await unpublishModule(mod, npmInfo.currentVersion);
    }
    await NpmRunner.run(mod, [ "publish" ]);
  } finally {
    getNpmInfoReader().invalidate(mod);

    if (isIgnoreCopied) {
      fs.unlinkSync(insideIgnore);
    }
  }

  let stateManager = getStateManager();
  stateManager.saveState(mod, PublishDependenciesSubset.getTag(), await stateManager.getActualState(mod));
}


/**
 * Builds and publishes module if something is changed inside the module.
 * Returns updated version of this module if module was published.
 * Returns undefined if module was not published.
 */
export async function publishModuleForSync(mod: LocalModule): Promise<boolean> {
  if (await buildModuleAndCheckItNeedsPublish(mod)) {
    await publishModule(mod);
    return true;
  }

  return false;
}


export async function publishModuleForFetch(mod: LocalModule): Promise<void> {
  if (!mod.useNpm) {
    return;
  }

  let currentVersion = (await getPackageReader().readPackageMetadata(mod.path)).version;
  if (!currentVersion) {
    return;
  }

  await publishModule(mod);
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


export async function publishModuleForRelease(mod: LocalModule, releaseType: ReleaseType): Promise<string | undefined> {
  let shouldPublish = await buildModuleAndCheckItNeedsPublish(mod);
  if (!shouldPublish) {
    return undefined;
  }

  let newVersion = await getVersionForRelease(mod, releaseType);

  await setPackageVersion(mod, newVersion);
  await publishModule(mod);

  return newVersion;
}
