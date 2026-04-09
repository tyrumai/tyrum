import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BufferedExecFileResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type BufferedExecFilePort = (
  file: string,
  args: readonly string[],
) => Promise<BufferedExecFileResult>;

type ExecFileFailure = NodeJS.ErrnoException & {
  stdout?: string;
  stderr?: string;
  code?: string | number;
};

export const runBufferedExecFile: BufferedExecFilePort = async (
  file,
  args,
): Promise<BufferedExecFileResult> => {
  try {
    const result = await execFileAsync(file, [...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as ExecFileFailure;
    if (failed.code === "ENOENT") throw failed;
    return {
      status: typeof failed.code === "number" ? failed.code : 1,
      stdout: typeof failed.stdout === "string" ? failed.stdout : "",
      stderr: typeof failed.stderr === "string" ? failed.stderr : failed.message,
    };
  }
};
