import * as semver from "semver";
import * as chalk from "chalk";
import { LocalModule } from "./local-module";
import { getCommandOutput, runCommand } from "./process";
import { getDirectModuleDeps } from "./dependencies";
import { getPublishedPackageInfo } from "./registry";
import * as path from "path";


interface Commit {
  message: string;
  hash: string;
}


export interface RepositoryChangesInfo {
  newCommits: Commit[];
  latestStableVersion: string | undefined;
  latestStableCommit: Commit | undefined;
}


function formatCommitMessage(c?: Commit) {
  if (!c) {
    return "";
  }

  return c.message.trim().replace(/\r?\n|\r/g, "");
}


function getVersionFromText(text: string): string | undefined {
  if (text.startsWith("v")) {
    text = text.slice(1);
  }

  return semver.valid(text) ? text : undefined;
}


function getVersionFromCommit(commit: Commit): string | undefined {
  let message = commit.message;

  // strip conventional commit prefix
  const sepIndex = message.indexOf(":");
  if (sepIndex >= 0) {
    message = message.slice(sepIndex + 1).trim();
  }

  const version = getVersionFromText(message);
  if (version) {
    return version;
  }

  return undefined;
}


async function listCommits(dir: string): Promise<Commit[]> {
  let output = await getCommandOutput("git", [ "rev-list", "HEAD", "--format=%H %s" ], {
    cwd: dir
  });

  return output
  .split("\n")
  .filter(line => !line.startsWith("commit ") && line)
  .map(line => {
    const spaceIndex = line.indexOf(" ");
    let hash = line.slice(0, spaceIndex);
    return {
      hash,
      message: line.slice(spaceIndex + 1)
    };
  });
}


export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    let output = await getCommandOutput("git", [ "rev-parse", "--is-inside-work-tree" ], {
      cwd: dir
    });
    output = output.trim();
    return output === "true";
  } catch (error) {
    if (error.exitCode === 128) {
      return false;
    } else {
      throw error;
    }
  }
}


/**
 * Returns list of commits after the latest version commit in the current branch.
 */
export async function getCommitsSinceLatestVersion(dir: string): Promise<RepositoryChangesInfo> {
  let latestVersionCommit: Commit | undefined;
  let latestVersion: string | undefined;
  let newCommits: Commit[] = [];

  for (const commit of await listCommits(dir)) {
    const version = getVersionFromCommit(commit);
    if (version) {
      latestVersionCommit = commit;
      latestVersion = version;
      break;
    } else {
      newCommits.push(commit);
    }
  }

  return {
    latestStableVersion: latestVersion,
    latestStableCommit: latestVersionCommit,
    newCommits
  };
}


export async function getCommitsSinceLastPublish(mod: LocalModule): Promise<RepositoryChangesInfo> {
  let latestStableVersion: string | undefined;
  let latestStableCommit: Commit | undefined;
  let newCommits: Commit[] = [];

  const publishInfo = await getPublishedPackageInfo(mod.checkedName.name);

  for (const commit of await listCommits(mod.path)) {
    const commitVersion = getVersionFromCommit(commit);
    if (!commitVersion || !publishInfo || !publishInfo.versions.includes(commitVersion)) {
      newCommits.push(commit);
    } else {
      latestStableCommit = commit;
      latestStableVersion = commitVersion;
      break;
    }
  }

  return {
    latestStableVersion,
    latestStableCommit,
    newCommits
  };
}


/**
 * Returns true if given repository has:
 *   - any staged, but not yet committed changes
 *   - any not yet staged changes
 */
export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  try {
    await getCommandOutput("git", [ "diff-index", "--quiet", "HEAD", "--exit-code" ], {
      cwd: dir
    });
    return false;
  } catch (error) {
    if (error.exitCode === 1) {
      return true;
    } else {
      throw error;
    }
  }
}


/**
 * Formats list of commits for displaying it to user.
 */
export function getShortCommitsOverview(commits: Commit[]): string {
  if (!commits.length) {
    return "";
  }

  const top = commits.slice(0, 10);

  let list = top.map(c => formatCommitMessage(c)).map(msg => "  " + chalk.gray(msg)).join("\n");
  if (top.length < commits.length) {
    list += `\n  ...and ${ commits.length - top.length } more`;
  }

  return list;
}


export async function stageAllAndCommit(mod: LocalModule, message: string, tag?: string): Promise<void> {
  await runCommand("git", [ "add", "." ], {
    cwd: mod.path
  });

  await runCommand("git", [ "commit", "-q", "-m", message ], {
    cwd: mod.path
  });

  if (tag) {
    await tagHead(mod.path, tag);
  }
}


export async function getCurrentBranchName(mod: LocalModule): Promise<string> {
  return (await getCommandOutput("git", [ "rev-parse", "--abbrev-ref", "HEAD" ], {
    cwd: mod.path
  })).trim();
}


export function dependsOnOneOf(mod: LocalModule, mods: LocalModule[]): boolean {
  return getDirectModuleDeps(mod, true).some(dep => mods.includes(dep.mod));
}


export async function changedSinceVersionCommit(mod: LocalModule): Promise<boolean> {
  if (!await isGitRepo(mod.path)) {
    return false;
  }

  if (await hasUncommittedChanges(mod.path)) {
    return true;
  }

  const newCommitsInfo = await getCommitsSinceLatestVersion(mod.path);
  if (newCommitsInfo.newCommits.length) {
    return true;
  }

  return false;
}


export async function changedSincePublish(mod: LocalModule): Promise<boolean> {
  if (!await isGitRepo(mod.path)) {
    return false;
  }

  if (await hasUncommittedChanges(mod.path)) {
    return true;
  }

  const newCommitsInfo = await getCommitsSinceLastPublish(mod);
  if (newCommitsInfo.newCommits.length) {
    return true;
  }

  return false;
}


export async function isFileChangedAfterTag(filePath: string, tagName: string): Promise<boolean> {
  try {
    const relativeFileName = path.basename(filePath);
    const dirName = path.dirname(filePath);
    await runCommand("git", [ "diff", "--exit-code", "--name-only", "HEAD", tagName, "--", relativeFileName ], {
      silent: true,
      cwd: dirName
    });
    return false;
  } catch (error) {
    if (error.exitCode === 1) {
      return true;
    } else {
      throw error;
    }
  }
}


export async function tagHead(dir: string, tagName: string): Promise<void> {
  await runCommand("git", [ "tag", "-a", tagName, "-m", tagName ], {
    cwd: dir
  });
}


export interface TagInfo {
  hash: string;
  name: string;
}


/**
 * Returns list of all tags in repository (latest tags come first)
 */
export async function listTags(dir: string): Promise<TagInfo[]> {
  try {
    return (await getCommandOutput("git", [ "show-ref", "--tags", "--dereference" ], { cwd: dir }))
    .split("\n")
    .filter(line => line.endsWith("^{}") && line)
    .map(line => {
      const spaceIndex = line.indexOf(" ");
      return {
        hash: line.slice(0, spaceIndex),
        name: line.slice(spaceIndex + 1 + "refs/tags/".length, -"^{}".length)
      };
    })
    .reverse();
  } catch (error) {
    if (error.exitCode === 1) {
      // show-ref returns 1 exit code if nothing matches the request https://linux.die.net/man/1/git-show-ref
      return [];
    } else {
      throw error;
    }
  }
}


export async function isFileChangedSincePrefixedTag(filePath: string, tagPrefix: string): Promise<boolean> {
  const repoPath = path.dirname(filePath);
  const tags = await listTags(repoPath);
  const latestMatchingTag = tags.find(tag => tag.name.startsWith(tagPrefix));
  if (!latestMatchingTag) {
    return true;
  }

  return isFileChangedAfterTag(filePath, latestMatchingTag.name);
}
