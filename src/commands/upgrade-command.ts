import { getProject } from "../project";
import { getArgs } from "../arguments";
import { LocalModule } from "../local-module";
import { DepType, getDirectPackageDeps } from "../dependencies";
import assert = require("assert");
import { getYarnExecutable, runCommand } from "../process";


export async function upgradeCommand() {
  const project = getProject();
  const args = getArgs();

  assert(args.subCommand === "upgrade");

  const jobs: { mod: LocalModule; pkg: string; type: DepType }[] = [];
  for (const pkg of args.packages) {
    for (const mod of project.modules) {
      const depType = getPackageDepType(mod, pkg);
      if (depType != null) {
        jobs.push({ mod, pkg, type: depType });
      }
    }
  }

  while (jobs.length) {
    const head = jobs.shift()!;

    const packages = [ head.pkg ];
    for (let q = 0; q < jobs.length; ++q) {
      if (jobs[q].mod === head.mod && jobs[q].type === head.type) {
        packages.push(jobs[q].pkg);
        jobs.splice(q, 1);
        --q;
      }
    }

    const modName = head.mod.checkedName.name;
    const flag = getDepFlag(head.type);

    const args = [ "workspace", modName, "add", flag, ...packages ].filter(x => x != null) as string[];

    try {
      await runCommand(getYarnExecutable(), args, {
        cwd: project.rootDir
      });
    } catch (error) {
      console.error(`Failed to update ${ packages.join(", ") } in ${ modName }: ${ error.message }`);
    }
  }
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
