let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  if (!input.trim()) {
    process.stderr.write("missing payload on stdin\n");
    process.exit(2);
    return;
  }

  const requested = Number.parseInt(process.env["STEP_RESULT_BYTES"] ?? "300000", 10);
  const size = Number.isFinite(requested) && requested > 0 ? requested : 300000;

  const response = {
    success: true,
    result: {
      ok: true,
      stdout: "x".repeat(size),
      stderr: "",
      exit_code: 0,
    },
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
