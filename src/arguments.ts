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
  subCommand: "each";
  changedOnly: boolean;
  notPublishedOnly: boolean;
  parallel: boolean;
  args: string[];
} | {
  subCommand: "publish";
  lockfileCopyPath?: string;
  prerelease?: string;
  dryRun: boolean;
  lockfileCheckProperty?: string;
});


export class ArgumentsManager {
  public get args() {
    return this._args;
  }


  public constructor() {
    let argparser = new argparse.ArgumentParser({
      add_help: true
    });
    argparser.add_argument("--config", "-c", {
      help: "Path to a directory containing workspace root package.json"
    });
    argparser.add_argument("--verbose", {
      help: "Verbose child process output",
      action: "store_true",
      default: false,
      dest: "verbose"
    });

    let subparsers = argparser.add_subparsers({
      title: "Subcommand",
      dest: "subCommand"
    });

    subparsers.add_parser("list", { help: "List all local modules" });
    subparsers.add_parser("tree", { help: "Show local modules dependency tree" });

    const eachParser = subparsers.add_parser("each", { help: "Execute yarn with given parameters in each module" });
    eachParser.add_argument("--changed", {
      help: "Only for modules that has new commits since the last version commit",
      action: "store_true",
      default: false,
      dest: "changedOnly"
    });
    eachParser.add_argument("--not-published", {
      help: "Only for modules that has new commits since the last published commit",
      action: "store_true",
      default: false,
      dest: "notPublishedOnly"
    });
    eachParser.add_argument("-p", "--parallel", {
      help: "Run commands in parallel (can break if modules depend on each other)",
      action: "store_true",
      default: false,
      dest: "parallel"
    });
    eachParser.add_argument("args", {
      help: "yarn arguments",
      nargs: argparse.REMAINDER
    });

    const publishParser = subparsers.add_parser("publish", { help: "Publish changed packages" });
    publishParser.add_argument("--lockfile-copy-path", {
      help: "Path relative to package root where lockfile should be copied after generating",
      dest: "lockfileCopyPath"
    });
    publishParser.add_argument("--prerelease", {
      help: "Generate prerelease versions",
      dest: "prerelease"
    });
    publishParser.add_argument("--dry-run", {
      help: "Do not actually publish or push anything (commits still will be made)",
      action: "store_true",
      default: false,
      dest: "dryRun"
    });
    publishParser.add_argument("--lockfile-check-prop", {
      help: "Set property to act like `alwaysUpdateLockFile` in package manifest",
      dest: "lockfileCheckProperty"
    });

    let args: Arguments = argparser.parse_args();
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


export function getArgs(): Arguments {
  return ServiceLocator.instance.get<ArgumentsManager>("args", () => new ArgumentsManager()).args;
}
