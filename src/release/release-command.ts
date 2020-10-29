import * as fs from "fs-extra";
import * as git from "nodegit";
import * as semver from "semver";
import * as chalk from "chalk";
import * as pluralize from "pluralize";
import * as prompts from "prompts";
import { getArgs } from "../arguments";
import { DepType, getDirectLocalDeps, ModuleDep, walkAllLocalModules, WalkerAction } from "../deps/dry-dependency-tree";
import { getManifestReader } from "../manifest-reader";
import { getProject } from "../project";
import { generateLockFile } from "lockfile-generator";
import { LocalModule } from "../local-module";
import { getYarnExecutable, runCommand } from "../process";


function setPackageVersion(dir: string, newVersion: string): void {
  let manifestReader = getManifestReader();

  let manifest = manifestReader.readPackageManifest(dir);
  let manifestPath = manifestReader.getPackageManifestPath(dir);
  fs.writeFileSync(manifestPath, JSON.stringify({
    ...manifest,
    version: newVersion
  }, undefined, 2), "utf-8");
  manifestReader.invalidate(dir);
}


function getCommitMessage(c: git.Commit | undefined): string {
  if (!c) {
    return "";
  }

  return c.message().trim().replace(/\r?\n|\r/g, "");
}


function looksLikeVersionCommit(msg: string): boolean {
  if (msg.startsWith("v")) {
    msg = msg.slice(1);
  }

  return !!semver.valid(msg);
}


async function openRepo(repoPath: string): Promise<git.Repository | null> {
  try {
    return await git.Repository.open(repoPath);
  } catch (error) {
    if (error.errno === git.Error.CODE.ENOTFOUND) {
      return null;
    }
    throw error;
  }
}


interface LastVersionCommits {
  newCommits: git.Commit[];
  latestVersionCommit: git.Commit | undefined;
}


async function getCommitsSinceLatestVersion(repo: git.Repository): Promise<LastVersionCommits> {
  let head = await repo.getHeadCommit();

  let historyReader = head.history();

  let commits = new Promise<LastVersionCommits>((resolve, reject) => {
    let newCommits: git.Commit[] = [];
    let isResolved = false;

    historyReader.on("commit", c => {
      if (isResolved) {
        return;
      }

      let message = getCommitMessage(c);
      if (looksLikeVersionCommit(message)) {
        isResolved = true;
        resolve({
          newCommits,
          latestVersionCommit: c
        });
      } else {
        newCommits.push(c);
      }
    });

    historyReader.on("end", () => {
      if (!isResolved) {
        resolve({
          newCommits,
          latestVersionCommit: undefined
        });
        isResolved = true;
      }
    });

    historyReader.on("error", reject);
  });

  historyReader.start();

  return commits;
}


async function hasUncommittedChanges(repo: git.Repository): Promise<boolean> {
  let statusFiles = await repo.getStatus();
  return statusFiles.length > 0;
}


async function installDeps(into: LocalModule, deps: ModuleDep[], type: DepType): Promise<void> {
  if (!deps.length) {
    return;
  }

  const project = getProject();
  const args = deps.map(dep => `${ dep.name }@"${ dep.range }"`);

  let saveFlag: string;
  switch (type) {
  case DepType.Dev:
    saveFlag = "--dev";
    break;

  case DepType.Production:
    saveFlag = "";
    break;

  case DepType.Peer:
    saveFlag = "--peer";
    break;
  }
  if (saveFlag !== "") {
    args.push(saveFlag);
  }

  await runCommand(getYarnExecutable(), [ "workspace", into.checkedName.name, "add", ...args ], {
    cwd: project.rootDir
  });
}


async function stageAllAndCommit(mod: LocalModule, message: string, tag?: string): Promise<void> {
  await runCommand("git", [ "add", "." ], {
    cwd: mod.path
  });

  await runCommand("git", [ "commit", "-m", message ], {
    cwd: mod.path
  });

  if (tag) {
    await runCommand("git", [ "tag", "-a", tag, "-m", tag ], {
      cwd: mod.path
    });
  }
}


function getShortCommitsOverview(commits: git.Commit[]): string {
  if (!commits.length) {
    return "";
  }

  const top = commits.slice(0, 10);

  let list = top.map(c => getCommitMessage(c)).map(msg => "  " + chalk.gray(msg)).join("\n");
  if (top.length < commits.length) {
    list += `\n  ...and ${ commits.length - top.length } more`;
  }

  return list;
}


export async function releaseCommand() {
  let args = getArgs();
  let project = getProject();

  if (args.subCommand !== "release") {
    throw new Error("Expected release");
  }

  function onCancel() {
    throw new Error("Cancelled");
  }

  let updatedModules = new Map<string, { from: string; to: string }>();

  let hasChanges = false;
  await walkAllLocalModules(async mod => {
    if (!mod.useNpm) {
      return;
    }

    let repo = await openRepo(mod.path);
    if (!repo) {
      return;
    }

    if (await hasUncommittedChanges(repo)) {
      console.log(`Module ${ mod.checkedName.name } has uncommitted changes. Please make commit before continuing`);
      hasChanges = true;
      return;
    }
  });

  if (hasChanges) {
    return;
  }

  await walkAllLocalModules(async mod => {
    if (!mod.useNpm) {
      return WalkerAction.Continue;
    }

    let manifest = getManifestReader().readPackageManifest(mod.path);
    if (!manifest) {
      return WalkerAction.Continue;
    }

    let modName = mod.checkedName.name;

    let repo = await openRepo(mod.path);
    if (!repo) {
      console.log(`Skipping module ${ modName }: not a git repository`);
      return WalkerAction.Continue;
    }

    let localDeps = getDirectLocalDeps(mod);
    let updateRanges: ModuleDep[] = [];
    for (let localDep of localDeps) {
      let depMod = project.getModuleChecked(localDep.name);
      let depName = depMod.checkedName.name;
      if (updatedModules.has(depName)) {
        let value = updatedModules.get(depName)!;

        if (!semver.satisfies(value.to, localDep.range)) {
          let newRange = await prompts({
            type: "select",
            name: "value",
            message: `${ modName } depends on ${ depName }@${ chalk.yellow(localDep.range) }, but ${ depName }@${ chalk.red(value.to) } no longer matches this requirement. We need to change semver range`,
            choices: [
              {
                title: `${ modName } is compatible with all versions of ${ depName } in range ${ localDep.range }`,
                value: `${ localDep.range } || ^${ value.to }`,
                description: `${ localDep.range } || ^${ value.to }`
              },
              {
                title: `${ modName } is compatible only with versions starting from ${ value.to }`,
                value: `^${ value.to }`,
                description: `^${ value.to }`
              }
            ]
          }, { onCancel });

          updateRanges.push({
            name: depName,
            range: newRange.value,
            type: localDep.type
          });
        }
      }
    }

    await installDeps(mod, updateRanges.filter(x => x.type === DepType.Production), DepType.Production);
    await installDeps(mod, updateRanges.filter(x => x.type === DepType.Dev), DepType.Dev);
    await installDeps(mod, updateRanges.filter(x => x.type === DepType.Peer), DepType.Peer);

    if (updateRanges.length && project.useLockFiles) {
      await generateLockFile(mod.path);
    }

    if (await hasUncommittedChanges(repo)) {
      await stageAllAndCommit(mod, "chore: update dependencies");
    }

    // todo: check if current version in package.json does not match version in version commit
    let versionCommits = await getCommitsSinceLatestVersion(repo);
    let newCommitCount = versionCommits.newCommits.length;
    if (newCommitCount > 0) {
      let currentVersion = manifest.version;

      let commits = getShortCommitsOverview(versionCommits.newCommits);
      let newVersion = await prompts({
        type: "select",
        name: "value",
        message: `Module ${ chalk.yellow(modName) } has ${ newCommitCount } new ${ pluralize("commit", newCommitCount) } since latest version commit:\n${ commits }\nPick a new version for this module (currently ${ currentVersion })`,
        choices: [
          {
            title: "patch",
            value: semver.inc(currentVersion, "patch") || "",
            description: semver.inc(currentVersion, "patch") || ""
          },
          {
            title: "minor",
            value: semver.inc(currentVersion, "minor") || "",
            description: semver.inc(currentVersion, "minor") || ""
          },
          {
            title: "major",
            value: semver.inc(currentVersion, "major") || "",
            description: semver.inc(currentVersion, "major") || ""
          },
          {
            title: "custom",
            value: "custom",
            description: "Enter new version manually"
          }
        ]
      }, { onCancel });

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
        }, { onCancel });
      }

      setPackageVersion(mod.path, newVersion.value);
      if (project.useLockFiles) {
        await generateLockFile(mod.path);
      }

      if (await hasUncommittedChanges(repo)) {
        const msg = "v" + newVersion.value;
        await stageAllAndCommit(mod, msg, msg);
      }

      updatedModules.set(modName, { from: currentVersion, to: newVersion.value });
    }

    return WalkerAction.Continue;
  });
}
