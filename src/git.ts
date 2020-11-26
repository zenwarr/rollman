import * as git from "nodegit";
import * as semver from "semver";
import * as chalk from "chalk";
import { LocalModule } from "./local-module";
import { runCommand } from "./process";
import { WalkerAction } from "./dependencies";
import { isVersionPublished } from "./registry";


export interface RepositoryChangesInfo {
  newCommits: git.Commit[];
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


/**
 * Checks that given commit message looks like this is version commit made by us.
 */
function looksLikeVersionCommit(commit: git.Commit): boolean {
  return getVersionFromCommit(commit) != null;
}


function getVersionFromCommit(commit: git.Commit): string | undefined {
  // todo: use tags instead

  let msg = formatCommitMessage(commit);
  if (msg.startsWith("v")) {
    return msg.slice(1);
  } else if (semver.valid(msg)) {
    return msg;
  } else {
    return undefined;
  }
}


/**
 * Formats and cleans commit message from libgit.
 */
function formatCommitMessage(c: git.Commit | undefined): string {
  if (!c) {
    return "";
  }

  return c.message().trim().replace(/\r?\n|\r/g, "");
}


async function walkCommits(repo: git.Repository, walker: (commit: git.Commit) => Promise<WalkerAction | void>): Promise<void> {
  let head = await repo.getHeadCommit();

  let historyReader = head.history();

  new Promise<void>((resolve, reject) => {
    let isResolved = false;

    historyReader.on("commit", (c: git.Commit) => {
      if (isResolved) {
        return;
      }

      walker(c).then(result => {
        if (result === WalkerAction.Stop) {
          isResolved = true;
          resolve();
        }
      }, reject);
    });

    historyReader.on("end", () => {
      if (!isResolved) {
        isResolved = true;
        resolve();
      }
    });

    historyReader.on("error", reject);
  });

  historyReader.start();
}


/**
 * Returns list of commits after the latest version commit in the current branch.
 */
export async function getCommitsSinceLatestVersion(repo: git.Repository): Promise<RepositoryChangesInfo> {
  let latestVersionCommit: git.Commit | undefined = undefined;
  let newCommits: git.Commit[] = [];

  await walkCommits(repo, async commit => {
    if (looksLikeVersionCommit(commit)) {
      latestVersionCommit = commit;
      return WalkerAction.Stop;
    } else {
      newCommits.push(commit);
      return WalkerAction.Continue;
    }
  });

  return {
    latestStableCommit: latestVersionCommit,
    newCommits
  };
}


export async function getCommitsSinceLastPublish(mod: LocalModule, repo: git.Repository): Promise<RepositoryChangesInfo> {
  let latestPublishedCommit: git.Commit | undefined = undefined;
  let newCommits: git.Commit[] = [];

  await walkCommits(repo, async commit => {
    const commitVersion = getVersionFromCommit(commit);
    if (!commitVersion || !await isVersionPublished(mod.checkedName.name, commitVersion)) {
      newCommits.push(commit);
      return WalkerAction.Continue;
    }

    latestPublishedCommit = commit;
    return WalkerAction.Stop;
  });

  return {
    latestStableCommit: latestPublishedCommit,
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
