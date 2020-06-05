import { LocalModule } from "./local-module";
import * as fs from "fs-extra";
import * as utils from "./process";


export async function fetchLocalModule(mod: LocalModule) {
  if (!mod.config.repository || (mod.config.path && fs.existsSync(mod.config.path))) {
    return;
  }

  let args: string[] = [ "clone", mod.config.repository, "-b", mod.config.branch, mod.config.path ];
  await utils.runCommand("git", args);

  mod.reloadInfo();
}
