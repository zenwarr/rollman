import { LocalModule } from "./local-module";
import { getCommandOutput, runCommand } from "./process";
import { getDirectModuleDeps } from "./dependencies";
import { getPublishedPackageInfo } from "./registry";
import * as path from "path";
import * as stream from "stream";
import gitSemverTags from "git-semver-tags";
import gitRawCommits from "git-raw-commits";


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
export async function getCommitsSinceLatestVersion(dir: string): Promise<string[]> {
  const versionTags = await getVersionTags(dir);
  return getRawCommits(dir, versionTags[0].tag);
}


export async function getCommitsSinceLastPublishedVersion(mod: LocalModule): Promise<string[]> {
  const publishInfo = await getPublishedPackageInfo(mod.checkedName.name);

  const versionTags = await getVersionTags(mod.path);
  const publishedVersionTag = versionTags.find(tag => publishInfo && publishInfo.versions.includes(tag.version))

  return getRawCommits(mod.path, publishedVersionTag?.tag);
}


/**
 * Returns true if given repository has:
 *   - any staged, but not yet committed changes
 *   - any not yet staged changes
 */
export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  try {
    await runCommand("git", [ "update-index", "--refresh" ], {
      cwd: dir,
      silent: true
    });

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

  const newCommits = await getCommitsSinceLatestVersion(mod.path);
  return newCommits.length > 0;
}


export async function changedSincePublish(mod: LocalModule): Promise<boolean> {
  if (!await isGitRepo(mod.path)) {
    return false;
  }

  if (await hasUncommittedChanges(mod.path)) {
    return true;
  }

  const newCommits = await getCommitsSinceLastPublishedVersion(mod);
  return newCommits.length > 0;
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


export interface VersionTag {
  tag: string;
  version: string
}


export async function getVersionTags(dir: string): Promise<VersionTag[]> {
  return new Promise((resolve, reject) => {
    gitSemverTags({
      cwd: dir
    } as any, (err, result) => {
      if (err != null) {
        reject(err);
      } else {
        resolve(result.map(tag => ({
          tag,
          version: getVersionFromTag(tag)
        })));
      }
    });
  });
}


function getVersionFromTag(tag: string) {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}


export async function getRawCommits(dir: string, from: string | undefined): Promise<string[]> {
  const result: string[] = [];

  const s = new stream.Writable();
  s._write = (value, _, done) => {
    result.push(value.toString().trim());
    done();
  };

  const commitStream = gitRawCommits({
    from
  }, {
    cwd: dir
  }).pipe(s);

  return new Promise((resolve, reject) => {
    commitStream.on("close", () => {
      resolve(result);
    });
    commitStream.on("error", reject);
  });
}
