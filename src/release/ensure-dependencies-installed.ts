import { getProject } from "../project";
import * as path from "path";
import * as fs from "fs-extra";


/**
 * Checks that workspace root has `node_modules` directory.
 * Of course, presence of node_modules does not guarantee correct lockfile generation, but missing node_modules guarantees it is going to fail.
 */
export function ensureDependenciesInstalled() {
  const project = getProject();
  if (!project.options.useLockFiles) {
    return true;
  }

  const modulesDir = path.join(project.rootDir, "node_modules");
  if (!fs.existsSync(modulesDir)) {
    console.error("It looks like you have not installed dependencies for your workspace root. Lockfile generation is going to fail. Run `yarn install` or `npm ci` before releasing.");
    return;
  }

  return true;
}
