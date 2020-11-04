import { getProject } from "../project";
import { getArgs } from "../arguments";
import { LocalModule } from "../local-module";
import { DepType, getDirectPackageDeps, walkModules } from "../dependencies";
import { getYarnExecutable, runCommand } from "../process";
import assert = require("assert");
import * as chalk from "chalk";


export async function upgradeCommand() {
  const project = getProject();
  const args = getArgs();

  assert(args.subCommand === "upgrade");

  const jobs: { mod: LocalModule; packages: string[]; type: DepType }[] = [];

  await walkModules(mod => {
    for (const pkg of args.packages) {
      const depType = getPackageDepType(mod, pkg);
      if (depType != null) {
        const existing = jobs.find(job => job.mod === mod && job.type === depType);
        if (existing) {
          existing.packages.push(pkg);
        } else {
          jobs.push({ mod, packages: [ pkg ], type: depType });
        }
      }
    }
  });

  if (!args.dryRun) {
    for (const job of jobs) {
      const modName = job.mod.checkedName.name;
      const flag = getDepFlag(job.type);

      const args = [ "workspace", modName, "add", flag, ...job.packages ].filter(x => x != null) as string[];

      try {
        await runCommand(getYarnExecutable(), args, {
          cwd: project.rootDir
        });
      } catch (error) {
        console.error(`Failed to update ${ job.packages.join(", ") } in ${ modName }: ${ error.message }`);
      }
    }

    // just to add empty line before report
    console.log();
  }

  console.log(jobs.map(job => chalk.green(`${ job.mod.checkedName.name } (${ getDepDesc(job.type) }): ${ job.packages.join(", ") }`)).join("\n"));
}


function getPackageDepType(mod: LocalModule, pkgSpec: string): DepType | undefined {
  let pkg = pkgSpec;
  if (pkg.indexOf("@", 1) >= 0) {
    pkg = pkg.slice(0, pkg.indexOf("@", 1));
  }

  if (pkg.startsWith("\"") && pkg.endsWith("\"")) {
    pkg = pkg.slice(1, -1);
  }

  const moduleDeps = getDirectPackageDeps(mod, true);
  return moduleDeps.find(dep => dep.name === pkg)?.type;
}


function getDepFlag(depType: DepType): string | undefined {
  switch (depType) {
  case DepType.Production:
    return undefined;

  case DepType.Peer:
    return "--peer";

  case DepType.Dev:
    return "--dev";
  }
}


function getDepDesc(depType: DepType): string {
  switch (depType) {
  case DepType.Production:
    return "prod";

  case DepType.Peer:
    return "peer";

  case DepType.Dev:
    return "dev";
  }
}
