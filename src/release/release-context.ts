import { LocalModule } from "../local-module";


export class ReleaseContext {
  public skipped: LocalModule[] = [];
}


export function cancelRelease() {
  process.exit(1);
}
