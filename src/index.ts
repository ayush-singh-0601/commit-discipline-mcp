export const PACKAGE_NAME = "commit-discipline-mcp";
export const PACKAGE_VERSION = "0.1.0";

export async function main(_args: string[]): Promise<number> {
  process.stderr.write("commit-discipline is not configured yet.\n");
  return 1;
}
