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

async function getNewVersionFrom(currentVersion: string, mod: LocalModule): Promise<string> {
  let response = await prompts({
    type: "select",
    name: "release",
    message: `Version ${ currentVersion } of module "${ mod.checkedName.name }" is already published on npm registry. Please set another version: `,
    choices: [
      ...releaseChoices.map(choice => ({
        title: choice,
        description: getOptionVersion(currentVersion, choice),
        value: choice
      })),
      { title: "custom", description: "Enter custom version...", value: "custom" }
    ],
    initial: prevSelectedRelease
  });

  let releaseType: semver.ReleaseType | "custom" | undefined = response.release;
  if (!releaseType) {
    shutdown(-1);
  }

  prevSelectedRelease = (releaseChoices as string[]).indexOf(releaseType);

  if (releaseType === "custom") {
    return getNewVersion(mod, `Enter new version for module "${ mod.checkedName.name }":`);
  }

  let newVersion = semver.inc(currentVersion, releaseType);
  if (!newVersion) {
    return getNewVersionFrom(currentVersion, mod);
  }

  return newVersion;
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

async function publishModule(mod: LocalModule): Promise<string> {
  let publishedVersion: string | undefined;

  let info = await getNpmInfoReader().getNpmInfo(mod);

  if (info.isCurrentVersionPublished || !info.currentVersion) {
    let newVersion = info.currentVersion ? await getNewVersionFrom(info.currentVersion, mod) : await getNewVersion(mod);

    await setPackageVersion(mod, newVersion);
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

  return publishedVersion;
}


/**
 * Publishes module if any publish dependencies are changed since last publish.
 * Returns updated version of this module if module was published.
 * Returns undefined if module was not published.
 */
export async function publishModuleIfChanged(mod: LocalModule): Promise<string | undefined> {
  if (await needsPublish(mod)) {
    return publishModule(mod);
  }

  return undefined;
}
