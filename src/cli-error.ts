/** An expected failure. `code` is the stable identifier reported to `--json` callers. */
export class CliError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
