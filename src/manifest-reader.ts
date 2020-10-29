import * as fs from "fs-extra";
import * as path from "path";
import { ServiceLocator } from "./locator";


export class ManifestReader {
  public getPackageManifestPath(modPath: string): string {
    return path.join(modPath, "package.json");
  }

  public readPackageManifest(dirPath: string): any | undefined {
    let filePath = this.getPackageManifestPath(dirPath);

    if (this._metadataCache.has(filePath)) {
      return this._metadataCache.get(filePath)!;
    }

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

    if (metadata != null) {
      this._metadataCache.set(filePath, metadata);
    }

    return metadata;
  }

  public invalidate(dirPath: string) {
    this._metadataCache.delete(dirPath);
  }

  public static init() {
    ServiceLocator.instance.initialize("manifestReader", new ManifestReader());
  }

  private _metadataCache = new Map<string, object | undefined>();
}


export function getManifestReader() {
  return ServiceLocator.instance.get<ManifestReader>("manifestReader");
}