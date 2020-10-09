import { getArgs } from "../arguments";
import { getProject } from "../project";
import * as path from "path";
import * as fs from "fs-extra";

export async function installIgnoreCommand() {
  const args = getArgs();

  if (args.subCommand !== "install-ignore") {
    return;
  }

  const project = getProject();

  for (let mod of project.modules) {
    let outsideIgnore = mod.outsideIgnoreFilePath;
    let insideIgnore = path.join(mod.path, ".npmignore");
    if (outsideIgnore && !fs.existsSync(insideIgnore)) {
      console.log(`.npmignore installed into ${ mod.checkedName.name }`);
      fs.copyFileSync(outsideIgnore, insideIgnore);
    }
  }
}
