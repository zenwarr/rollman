import * as fs from "fs";
import { getArgs } from "../arguments";
import { getProject } from "../project";
import { NpmRunner } from "../module-npm-runner";
import { NpmRegistry } from "../registry";
import { getConfig } from "../config/config";
import { Lockfile } from "../lockfile";


const CAN_CHANGE_LOCKFILE = [ "i", "install", "add", "link", "ln", "audit", "r", "rm", "remove", "un", "unlink", "uninstall", "prune", "update", "up", "upgrade" ];


export async function npmCommand() {
  let args = getArgs();
  if (args.subCommand !== "npm") {
    return;
  }

  getConfig().processVerbose = true;

  await NpmRegistry.init();

  let project = getProject();
  let dir = fs.realpathSync(process.cwd());
  let mod = project.modules.find(module => module.path === dir);

  let npmArgs = args.args;

  await NpmRunner.run(mod, npmArgs);

  if (mod && npmArgs.length > 1 && CAN_CHANGE_LOCKFILE.includes(npmArgs[0]) && Lockfile.existsInModule(mod)) {
    Lockfile.forModule(mod).update();
  }
}
