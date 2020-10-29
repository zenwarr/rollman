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
});


export class ArgumentsManager {
  public get args() {
    return this._args;
  }

  protected constructor() {
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

    subparsers.addParser("list-modules", { help: "List all modules loaded from the configuration files" });
    subparsers.addParser("dependency-tree", { help: "Show local modules dependency tree" });

    subparsers.addParser("release", { help: "Release management" });

    let args: Arguments = argparser.parseArgs();
    this._args = args;

    if (args.config) {
      if (!path.isAbsolute(args.config)) {
        args.config = path.resolve(process.cwd(), args.config);
      }
    }
  }


  private readonly _args: Arguments;


  public static init() {
    const parser = new ArgumentsManager();
    ServiceLocator.instance.initialize("args", parser);
  }
}


export function getArgs() {
  return ServiceLocator.instance.get<ArgumentsManager>("args").args;
}
