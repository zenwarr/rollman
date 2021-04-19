import { LocalModule } from "./local-module";
import * as path from "path";
import * as fs from "fs-extra";
import * as glob from "glob";
import { ServiceLocator } from "./locator";
import { getArgs } from "./arguments";
import { getManifestManager } from "./manifest-manager";
import { isFileChangedSincePrefixedTag } from "./git";


export interface ProjectOptions {
  useLockFiles: boolean;
  alwaysUpdateLockFile: boolean;
  useGitTags: boolean;
  publishIfSourceNotChanged: boolean;
}


export const DEFAULT_PUBLISH_IF_SOURCE_NOT_CHANGED = true;


export class Project {
  public constructor(private _rootDir: string, private _modules: LocalModule[], private _options: ProjectOptions) {
  }


  public get modules() {
    return this._modules;
  }


  public get options() {
    return this._options;
  }


  public get rootDir() {
    return this._rootDir;
  }


  public getModule(moduleName: string): LocalModule | null {
    return this._modules.find(module => module.name && module.name.name === moduleName) || null;
  }


  public static loadProject(startDir: string): Project {
    let projectDir = this.findProjectDir(startDir);
    let manifest = getManifestManager().readPackageManifest(projectDir);
    let patterns: string[] = typeof manifest.workspaces.packages === "string" ? [ manifest.workspaces.packages ] : manifest.workspaces.packages;

    let packagePaths = new Set<string>();
    for (let pattern of patterns) {
      let files = glob.sync(pattern, {
        cwd: projectDir
      });
      for (let filename of files) {
        packagePaths.add(path.join(projectDir, filename));
      }
    }

    let useLockFiles = manifest.rollman?.useLockFiles ?? false;
    if (typeof useLockFiles !== "boolean") {
      throw new Error(`rollman.useLockFiles should be a boolean in ${ projectDir }/package.json`);
    }

    let useGitTags = manifest.rollman?.useGitTags ?? true;
    if (typeof useGitTags !== "boolean") {
      throw new Error(`rollman.useGitTags should be a boolean in ${ projectDir }/package.json`);
    }

    let alwaysUpdateLockFile = manifest.rollman?.alwaysUpdateLockFile ?? false;
    if (typeof alwaysUpdateLockFile !== "boolean") {
      throw new Error(`rollman.alwaysUpdateLockFile should be a boolean in ${ projectDir }/package.json`);
    }

    let publishIfSourceNotChanged = manifest.rollman?.publishIfSourceNotChanged;
    if (publishIfSourceNotChanged != null && typeof publishIfSourceNotChanged !== "boolean") {
      throw new Error(`Invalid "rollman.publishIfSourceNotChanged" param in ${ projectDir }/package.json: should be a boolean`);
    }

    let modules = [ ...packagePaths.values() ].map(packagePath => LocalModule.createFromPackage(packagePath));
    return new Project(projectDir, modules, {
      useLockFiles,
      useGitTags,
      alwaysUpdateLockFile,
      publishIfSourceNotChanged: publishIfSourceNotChanged ?? DEFAULT_PUBLISH_IF_SOURCE_NOT_CHANGED
    });
  }


  public static findProjectDir(startDir: string): string {
    const findConfigForDir = (dir: string): string => {
      if (!dir || dir === "/" || dir === ".") {
        throw new Error("No package.json with workspaces enabled found in directory tree");
      }

      if (fs.existsSync(dir) && isWorkspaceEnabled(dir)) {
        return dir;
      } else {
        return findConfigForDir(path.dirname(dir));
      }
    };

    return findConfigForDir(startDir);
  }


  public static init() {
    const args = getArgs();
    const project = Project.loadProject(args.config || process.cwd());
    ServiceLocator.instance.initialize("project", project);
  }
}


function isWorkspaceEnabled(manifestPath: string) {
  let manifest = getManifestManager().readPackageManifest(manifestPath);
  return !!(manifest && manifest.workspaces);
}


export function getProject() {
  return ServiceLocator.instance.get<Project>("project");
}


export const ROOT_REPO_RELEASE_TAG_PREFIX = "released-";


export async function shouldForcePublish(project: Project): Promise<boolean> {
  return isFileChangedSincePrefixedTag(path.join(project.rootDir, "yarn.lock"), ROOT_REPO_RELEASE_TAG_PREFIX);
}
