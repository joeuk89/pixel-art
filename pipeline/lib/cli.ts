export async function main(run: () => object | Promise<object>): Promise<void> {
  try {
    const result = await run();
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + "\n");
    if ("ok" in result && result.ok === false) process.exitCode = 1;
  } catch (e) {
    const error = (e as Error).message;
    process.stderr.write(error + "\n");
    process.stdout.write(JSON.stringify({ ok: false, error }, null, 2) + "\n");
    process.exitCode = 1;
  }
}
