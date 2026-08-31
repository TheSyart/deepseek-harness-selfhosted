/**
 * Electron main-process runtime normalization for packaged launches.
 * @module @deepseek-ai/dsh-desktop-app/main-runtime
 */

/**
 * Supply the JavaScript entry argument that Electron omits when macOS launches
 * a packaged application through Launch Services.
 * @param argv - the mutable Electron process argument list.
 * @param entryPath - the absolute main-process JavaScript entry path.
 */
export function ensureMainEntryArgument(argv: string[], entryPath: string): void {
  if (argv[1] === undefined) argv.push(entryPath)
}
