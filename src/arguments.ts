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
  subCommand: "each";
  changedOnly: boolean;
  args: string[];
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

    const eachParser = subparsers.addParser("each", { help: "Execute yarn with given parameters in each module" });
    eachParser.addArgument("--changed", {
      help: "Only for modules that has changed since last publish",
      action: "storeTrue",
      defaultValue: false,
      dest: "changedOnly"
    });
    eachParser.addArgument("args", {
      help: "yarn arguments",
      nargs: argparse.Const.REMAINDER
    });

    let args: Arguments = argparser.parseArgs();
    this._args = args;

    if (this._args.subCommand === "each" && this._args.args.length < 1) {
      throw new Error("Expected one or more arguments for \"each\" command");
    }

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
