import { getNpmRc } from "./npmrc";
import { ModuleNpmName } from "./local-module";


export function getRegistryForPackage(name: ModuleNpmName) {
  const npmrc = getNpmRc();
  return (name.scope && npmrc.getCustomRegistry(name.scope)) || npmrc.defaultRegistry;
}
