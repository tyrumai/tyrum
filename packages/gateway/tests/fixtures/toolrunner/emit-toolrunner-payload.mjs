let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const parsed = JSON.parse(input || "{}");
  process.stdout.write(JSON.stringify({ success: true, result: parsed }) + "\n");
});
