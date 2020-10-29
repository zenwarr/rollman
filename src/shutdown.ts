export function shutdown(exitCode?: number): never {
  process.exit(exitCode);
}
