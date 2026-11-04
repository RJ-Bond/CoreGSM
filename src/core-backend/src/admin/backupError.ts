/** user-facing error (message is shown in the panel) */
export class BackupError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
