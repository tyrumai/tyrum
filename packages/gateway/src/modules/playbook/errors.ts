export class PlaybookCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaybookCompileError";
  }
}
