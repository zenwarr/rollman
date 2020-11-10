import * as path from "path";
import { getProject } from "../project";
import { getCurrentBranchName, openRepo } from "../release/git";
import { runCommand } from "../process";
import assert = require("assert");


export async function cloneCommand() {
  const project = getProject();

  const projectRepo = await openRepo(project.rootDir);
  if (!projectRepo) {
    throw new Error(`Cannot clone: root project directory (${ project.rootDir }) is not inside git repository`);
  }

  const repositories = project.options.repositories || [];
  if (!repositories.length) {
    console.log("Nothing to clone: no repositories defined in project");
    return;
  }

  const projectBranch = await getCurrentBranchName(projectRepo);
  for (const repoUrl of repositories) {
    assert(project.options.cloneDir, "Should be defined if repositories is not empty");

    await runCommand("git", [ "clone", repoUrl, "-b", projectBranch ], {
      cwd: path.join(project.rootDir, project.options.cloneDir)
    });
  }
}
