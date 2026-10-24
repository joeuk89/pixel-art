export function main(run: () => object): void {
  try {
    process.stdout.write(JSON.stringify({ ok: true, ...run() }, null, 2) + "\n");
  } catch (e) {
    const error = (e as Error).message;
    process.stderr.write(error + "\n");
    process.stdout.write(JSON.stringify({ ok: false, error }, null, 2) + "\n");
    process.exitCode = 1;
  }
}
