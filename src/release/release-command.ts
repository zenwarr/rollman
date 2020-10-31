import * as fs from "fs-extra";
import * as git from "nodegit";
import * as semver from "semver";
import * as chalk from "chalk";
import * as pluralize from "pluralize";
import * as prompts from "prompts";
import { DepType, getDirectLocalDeps, ModuleDep, walkAllLocalModules, WalkerAction } from "../deps/dry-dependency-tree";
import { getManifestReader } from "../manifest-reader";
import { getProject } from "../project";
import { generateLockFile } from "lockfile-generator";
import { LocalModule } from "../local-module";
import { getYarnExecutable, runCommand } from "../process";


interface ReleaseContext {
  updated: Map<string, { from: string, to: string }>;
  skipped: LocalModule[];
}


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


function onCancel() {
  throw new Error("Cancelled");
}


const DEFAULT_RELEASE_BRANCH = "master";


async function ensureReleaseBranch(mod: LocalModule, repo: git.Repository): Promise<boolean> {
  const manifest = getManifestReader().readPackageManifest(mod.path);
  const releaseBranchesParam = manifest?.rollman?.releaseBranches;
  if (releaseBranchesParam && (!Array.isArray(releaseBranchesParam) || !releaseBranchesParam.every(x => typeof x === "string"))) {
    throw new Error(`Invalid rollman.releaseBranch parameter in module ${ mod.checkedName.name }: array of strings expected`);
  }

  const releaseBranches: string[] = releaseBranchesParam ?? [ DEFAULT_RELEASE_BRANCH ];

  const currentBranch = (await repo.getCurrentBranch()).name().replace(/^refs\/heads\//, "");
  if (!releaseBranches.includes(currentBranch)) {
    console.error(`Module ${ mod.checkedName.name } is on branch ${ currentBranch }, but releases are not allowed on this branch`);
    return false;
  }

  return true;
}


async function getModulesToSkip(): Promise<false | LocalModule[]> {
  let result: false | LocalModule[] = [];

  await walkAllLocalModules(async mod => {
    if (!mod.useNpm) {
      return;
    }

    let repo = await openRepo(mod.path);
    if (!repo) {
      return;
    }

    if (!await ensureReleaseBranch(mod, repo)) {
      result = false;
    }

    if (result !== false && await hasUncommittedChanges(repo)) {
      const reply = await prompts({
        type: "select",
        name: "value",
        message: `Module ${ chalk.yellow(mod.checkedName.name) } has uncommitted changes. Do you want to continue?`,
        choices: [
          {
            title: "No, abort release process and do nothing",
            value: "exit"
          },
          {
            title: "Continue, but do not release the module and all modules that depend on it",
            value: "ignore"
          }
        ]
      }, { onCancel });
      if (reply.value === "exit") {
        result = false;
        return WalkerAction.Stop;
      } else if (reply.value === "ignore" && result) {
        result.push(mod);
      }
    }

    return WalkerAction.Continue;
  });

  return result;
}


function shouldBeSkipped(ctx: ReleaseContext, directLocalDeps: ModuleDep[], mod: LocalModule): boolean {
  const project = getProject();

  if (ctx.skipped.includes(mod)) {
    return true;
  }

  const skipReason = directLocalDeps.find(d => ctx.skipped.includes(project.getModuleChecked(d.name)));
  if (skipReason) {
    console.log(`Skipping module ${ chalk.yellow(mod.checkedName.name) } because it depends on ignored module ${ chalk.yellow(skipReason.name) }`);
    ctx.skipped.push(mod);
    return true;
  }

  return false;
}


async function updateDependencyRanges(ctx: ReleaseContext, mod: LocalModule, localDeps: ModuleDep[], repo: git.Repository) {
  const modName = mod.checkedName.name;
  const project = getProject();

  let updateRanges: ModuleDep[] = [];
  for (let localDep of localDeps) {
    let depMod = project.getModuleChecked(localDep.name);
    let depName = depMod.checkedName.name;
    if (ctx.updated.has(depName)) {
      let value = ctx.updated.get(depName)!;

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
}


async function releaseNewVersion(ctx: ReleaseContext, mod: LocalModule, localDeps: ModuleDep[], repo: git.Repository) {
  const modName = mod.checkedName.name;
  const project = getProject();
  const manifest = getManifestReader().readPackageManifest(mod.path);

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
        },
        {
          title: "Ignore, do not release this module and all modules that depend on it",
          value: "skip"
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
    } else if (newVersion.value === "skip") {
      ctx.skipped.push(mod);
      return;
    }

    setPackageVersion(mod.path, newVersion.value);
    if (project.useLockFiles) {
      await generateLockFile(mod.path);
    }

    if (await hasUncommittedChanges(repo)) {
      const msg = "v" + newVersion.value;
      await stageAllAndCommit(mod, msg, project.useGitTags ? msg : undefined);
    }

    ctx.updated.set(modName, { from: currentVersion, to: newVersion.value });
  }
}


export async function releaseCommand() {
  const modulesToSkip = await getModulesToSkip();
  if (!modulesToSkip) {
    return;
  }

  const ctx: ReleaseContext = {
    updated: new Map(),
    skipped: modulesToSkip
  };

  await walkAllLocalModules(async mod => {
    const localDeps = getDirectLocalDeps(mod);
    if (!mod.useNpm || shouldBeSkipped(ctx, localDeps, mod)) {
      return WalkerAction.Continue;
    }

    let repo = await openRepo(mod.path);
    if (!repo) {
      return WalkerAction.Continue;
    }

    await updateDependencyRanges(ctx, mod, localDeps, repo);

    await releaseNewVersion(ctx, mod, localDeps, repo);

    return WalkerAction.Continue;
  });
}
