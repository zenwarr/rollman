import { ServiceLocator } from "./locator";
import * as argparse from "argparse";
import * as path from "path";


export type Arguments = {
  config: string | null;
  verbose: boolean;
} & ({
  subCommand: "list-modules";
} | {
  subCommand: "dependency-tree";
} | {
  subCommand: "release";
} | {
  subCommand: "upgrade";
  packages: string[];
});


export class ArgumentsManager {
  public get args() {
    return this._args;
  }

  public constructor() {
    let argparser = new argparse.ArgumentParser({
      addHelp: true
    });
    argparser.addArgument([ "--config", "-c" ], {
      help: "Path to a directory containing workspace root package.json"
    });
    argparser.addArgument("--verbose", {
      help: "Verbose child process output",
      action: "storeTrue",
      defaultValue: false,
      dest: "verbose"
    });

    let subparsers = argparser.addSubparsers({
      title: "Subcommand",
      dest: "subCommand"
    });

    subparsers.addParser("list", { help: "List all local modules" });
    subparsers.addParser("tree", { help: "Show local modules dependency tree" });
    subparsers.addParser("release", { help: "Release modules" });

    const upgradeParser = subparsers.addParser("upgrade", { help: "Upgrades package in all workspaces to the latest version" });
    upgradeParser.addArgument("packages", {
      help: "Package name to upgrade to latest version in all workspaces",
      nargs: "+"
    });

    let args: Arguments = argparser.parseArgs();
    this._args = args;

    if (args.config) {
      if (!path.isAbsolute(args.config)) {
        args.config = path.resolve(process.cwd(), args.config);
      }
    }
  }


  private readonly _args: Arguments;
}


export function getArgs() {
  return ServiceLocator.instance.get<ArgumentsManager>("args", () => new ArgumentsManager()).args;
}
