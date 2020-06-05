import { getArgs } from "../arguments";
import { getProject } from "../project";
import { NpmRunner } from "../module-npm-runner";
import { NpmRegistry } from "../registry";
import { getConfig } from "../config/config";


export async function npmCommand() {
  let args = getArgs();
  if (args.subCommand !== "npm") {
    return;
  }

  getConfig().processVerbose = true;

  let project = getProject();

  let dir = process.cwd();

  let mod = project.modules.find(module => module.path === dir);
  if (!mod) {
    throw new Error(`Failed to find local module at current working directory ("${ dir }")`);
  }

  await NpmRegistry.init();

  await NpmRunner.run(mod, args.args);
}
