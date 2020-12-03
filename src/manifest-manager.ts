import * as fs from "fs-extra";
import * as path from "path";
import { ServiceLocator } from "./locator";


export class ManifestManager {
  public getPackageManifestPath(modPath: string): string {
    return path.join(modPath, "package.json");
  }

  public readPackageManifest(dirPath: string): any | undefined {
    let filePath = this.getPackageManifestPath(dirPath);

    let metadata: object | undefined;
    try {
      metadata = fs.readJSONSync(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        metadata = undefined;
      } else {
        throw error;
      }
    }

    if (metadata && typeof metadata !== "object") {
      throw new Error(`Expected contents of ${ filePath } to be object`);
    }

    return metadata;
  }

  public writePackageManifest(dir: string, data: object): void {
    const manifestPath = this.getPackageManifestPath(dir);

    fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }
}


export function getManifestManager() {
  return ServiceLocator.instance.get<ManifestManager>("manifestManager", () => new ManifestManager());
}
