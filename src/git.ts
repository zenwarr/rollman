import * as git from "nodegit";
import * as semver from "semver";
import * as chalk from "chalk";
import { LocalModule } from "./local-module";
import { runCommand } from "./process";
import { getDirectModuleDeps } from "./dependencies";
import { getPublishedPackageInfo } from "./registry";


export interface RepositoryChangesInfo {
  newCommits: git.Commit[];
  latestStableVersion: string | undefined;
  latestStableCommit: git.Commit | undefined;
}


/**
 * Returns repository object for given path, if the path is inside git repository.
 * Returns `null` if path is outside a git repository.
 */
export async function openRepo(repoPath: string): Promise<git.Repository | null> {
  try {
    return await git.Repository.open(repoPath);
  } catch (error) {
    if (error.errno === git.Error.CODE.ENOTFOUND) {
      return null;
    }
    throw error;
  }
}


function formatCommitMessage(c: git.Commit) {
  if (!c) {
    return "";
  }

  return c.message().trim().replace(/\r?\n|\r/g, "");
}


export interface TagInfo {
  name: string;
  commit: git.Commit;
}


async function getTags(repo: git.Repository): Promise<TagInfo[]> {
  let tagNames: string[] = await git.Tag.list(repo);
  let commits = await Promise.all(tagNames.map(tagName => repo.getReferenceCommit(tagName)));

  return tagNames.map((tagName, index) => ({
    name: tagName,
    commit: commits[index]
  }));
}


function getCommitTags(commit: git.Commit, tags: TagInfo[]): TagInfo[] {
  return tags.filter(tag => commit.id().equal(tag.commit.id()));
}


function getVersionFromText(text: string): string | undefined {
  if (text.startsWith("v")) {
    text = text.slice(1);
  }

  return semver.valid(text) ? text : undefined;
}


function getVersionFromCommit(commit: git.Commit, allTags: TagInfo[]): string | undefined {
  const commitTags = getCommitTags(commit, allTags);
  for (const commitTag of commitTags) {
    const version = getVersionFromText(commitTag.name);
    if (version) {
      return version;
    }
  }

  return undefined;
}


async function listCommits(repo: git.Repository): Promise<git.Commit[]> {
  let head = await repo.getHeadCommit();
  let historyReader = head.history();
  let commits: git.Commit[] = [];

  return new Promise<git.Commit[]>((resolve, reject) => {
    historyReader.start();

    historyReader.on("commit", (c: git.Commit) => {
      commits.push(c);
    });

    historyReader.on("end", () => {
      resolve(commits);
    });

    historyReader.on("error", reject);
  });
}


/**
 * Returns list of commits after the latest version commit in the current branch.
 */
export async function getCommitsSinceLatestVersion(repo: git.Repository): Promise<RepositoryChangesInfo> {
  let latestVersionCommit: git.Commit | undefined;
  let latestVersion: string | undefined;
  let newCommits: git.Commit[] = [];
  const allTags = await getTags(repo);

  for (const commit of await listCommits(repo)) {
    const version = getVersionFromCommit(commit, allTags);
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


export async function getCommitsSinceLastPublish(mod: LocalModule, repo: git.Repository): Promise<RepositoryChangesInfo> {
  let latestStableVersion: string | undefined;
  let latestStableCommit: git.Commit | undefined;
  let newCommits: git.Commit[] = [];
  const allTags = await getTags(repo);

  const publishInfo = await getPublishedPackageInfo(mod.checkedName.name);

  for (const commit of await listCommits(repo)) {
    const commitVersion = getVersionFromCommit(commit, allTags);
    if (!commitVersion || !publishInfo || !publishInfo.versions.includes(commitVersion)) {
      newCommits.push(commit);
    } else {
      latestStableCommit = commit;
      latestStableVersion = commitVersion;
      break;
    }
  }

  console.log("info", latestStableVersion, latestStableCommit);

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
export async function hasUncommittedChanges(repo: git.Repository): Promise<boolean> {
  let statusFiles = await repo.getStatus();
  return statusFiles.length > 0;
}


/**
 * Formats list of commits for displaying it to user.
 */
export function getShortCommitsOverview(commits: git.Commit[]): string {
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
    await runCommand("git", [ "tag", "-a", tag, "-m", tag ], {
      cwd: mod.path
    });
  }
}


export async function getCurrentBranchName(repo: git.Repository): Promise<string> {
  return (await repo.getCurrentBranch()).name().replace(/^refs\/heads\//, "");
}


export function dependsOnOneOf(mod: LocalModule, mods: LocalModule[]): boolean {
  return getDirectModuleDeps(mod, true).some(dep => mods.includes(dep.mod));
}


export async function changedSinceVersionCommit(mod: LocalModule): Promise<boolean> {
  const repo = await openRepo(mod.path);
  if (!repo) {
    return false;
  }

  if (await hasUncommittedChanges(repo)) {
    return true;
  }

  const newCommitsInfo = await getCommitsSinceLatestVersion(repo);
  if (newCommitsInfo.newCommits.length) {
    return true;
  }

  console.log(`Module ${ chalk.yellow(mod.formattedName) } has no changes since previous version commit, skipping`);
  return false;
}


export async function changedSincePublish(mod: LocalModule): Promise<boolean> {
  const repo = await openRepo(mod.path);
  if (!repo) {
    return false;
  }

  if (await hasUncommittedChanges(repo)) {
    return true;
  }

  const newCommitsInfo = await getCommitsSinceLastPublish(mod, repo);
  if (newCommitsInfo.newCommits.length) {
    return true;
  }

  console.log(`Module ${ chalk.yellow(mod.formattedName) } has no changes since previous published version, skipping`);
  return false;
}
