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

  await NpmRegistry.init();

  let project = getProject();
  let dir = process.cwd();
  let mod = project.modules.find(module => module.path === dir);
  await NpmRunner.run(mod, args.args);
}
