import { walkModules } from "../dependencies";
import { getYarnExecutable, runCommand } from "../process";
import { getArgs } from "../arguments";
import { getManifestManager } from "../manifest-manager";
import assert = require("assert");


export async function eachCommand() {
  const args = getArgs();

  assert(args.subCommand === "each");

  const scriptName = args.args[0];

  await walkModules(async mod => {
    if (!mod.useNpm) {
      return;
    }

    const manifest = getManifestManager().readPackageManifest(mod.path);
    if (!(scriptName in manifest.scripts)) {
      console.log(`Script ${ scriptName } not present in module ${ mod.checkedName.name }, skipping`);
      return;
    }

    await runCommand(getYarnExecutable(), args.args, {
      cwd: mod.path
    });
  });
}
