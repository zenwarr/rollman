import { getManifestManager } from "../manifest-manager";
import * as fs from "fs-extra";
import { cancelRelease, ReleaseContext } from "./release-context";
import { LocalModule } from "../local-module";
import { getProject } from "../project";
import {
  getCommitsSinceLatestVersion,
  getShortCommitsOverview,
  hasUncommittedChanges,
  LastVersionCommits,
  stageAllAndCommit
} from "./git";
import * as prompts from "prompts";
import * as chalk from "chalk";
import * as pluralize from "pluralize";
import * as semver from "semver";
import { generateLockFile } from "lockfile-generator";


function setPackageVersion(dir: string, newVersion: string): void {
  let manifestManager = getManifestManager();

  let manifest = manifestManager.readPackageManifest(dir);
  if (manifest.version === newVersion) {
    // avoid making whitespace-only changes
    return;
  }

  manifestManager.writePackageManifest(dir, {
    ...manifest,
    version: newVersion
  });
}


function getSemVerChoice(type: semver.ReleaseType, currentVersion: string) {
  return {
    title: type,
    value: semver.inc(currentVersion, type) || "",
    description: semver.inc(currentVersion, type) || ""
  };
}


async function askForNewVersion(ctx: ReleaseContext, mod: LocalModule, currentVersion: string, versionCommits: LastVersionCommits): Promise<string | false> {
  const modName = mod.checkedName.name;

  const commits = getShortCommitsOverview(versionCommits.newCommits);
  const newCommitCount = versionCommits.newCommits.length;

  let newVersion = await prompts({
    type: "select",
    name: "value",
    message: `Module ${ chalk.yellow(modName) } has ${ newCommitCount } new ${ pluralize("commit", newCommitCount) } since latest version commit:\n${ commits }\nPick a new version for this module (currently ${ currentVersion })`,
    choices: [
      getSemVerChoice("patch", currentVersion),
      getSemVerChoice("minor", currentVersion),
      getSemVerChoice("major", currentVersion),
      {
        title: "custom",
        value: "custom",
        description: "Enter new version manually"
      },
      {
        title: "Ignore, do not release this module and all modules that depend on it",
        value: "skip"
      }
    ]
  }, { onCancel: cancelRelease });

  if (newVersion.value === "custom") {
    newVersion = await prompts({
      type: "text",
      name: "value",
      message: `Enter a new version for module ${ modName } (currently ${ currentVersion })`,
      validate: (value: string) => {
        value = value.trim();

        if (!semver.valid(value)) {
          return "Should be a valid semver version";
        } else if (value === currentVersion) {
          return "Should not be equal to the current version";
        } else {
          return true;
        }
      }
    }, { onCancel: cancelRelease });
  } else if (newVersion.value === "skip") {
    return false;
  }

  return newVersion.value;
}


/**
 * Runs release process for given module.
 */
export async function releaseModule(ctx: ReleaseContext, mod: LocalModule) {
  const project = getProject();
  const versionBeforeRelease = getManifestManager().readPackageManifest(mod.path).version;

  const repo = await ctx.getRepo(mod);
  if (!repo) {
    return;
  }

  let versionCommits = await getCommitsSinceLatestVersion(repo);
  if (versionCommits.newCommits.length > 0) {
    const newVersion = await askForNewVersion(ctx, mod, versionBeforeRelease, versionCommits);
    if (!newVersion) {
      ctx.skipped.push(mod);
      return;
    }

    setPackageVersion(mod.path, newVersion);
    if (project.options.useLockFiles) {
      await generateLockFile(mod.path);
    }

    if (await hasUncommittedChanges(repo)) {
      const msg = "v" + newVersion;
      await stageAllAndCommit(mod, msg, project.options.useGitTags ? msg : undefined);
    }
  }
}
