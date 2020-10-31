import * as git from "nodegit";
import * as semver from "semver";
import * as chalk from "chalk";
import { LocalModule } from "../local-module";
import { runCommand } from "../process";


export interface LastVersionCommits {
  newCommits: git.Commit[];
  latestVersionCommit: git.Commit | undefined;
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
function looksLikeVersionCommit(msg: string): boolean {
  // todo: use tags instead
  if (msg.startsWith("v")) {
    msg = msg.slice(1);
  }

  return !!semver.valid(msg);
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


/**
 * Returns list of commits after the latest version commit in the current branch.
 */
export async function getCommitsSinceLatestVersion(repo: git.Repository): Promise<LastVersionCommits> {
  let head = await repo.getHeadCommit();

  let historyReader = head.history();

  let commits = new Promise<LastVersionCommits>((resolve, reject) => {
    let newCommits: git.Commit[] = [];
    let isResolved = false;

    historyReader.on("commit", c => {
      if (isResolved) {
        return;
      }

      let message = formatCommitMessage(c);
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

  await runCommand("git", [ "commit", "-m", message ], {
    cwd: mod.path
  });

  if (tag) {
    await runCommand("git", [ "tag", "-a", tag, "-m", tag ], {
      cwd: mod.path
    });
  }
}
