const err = new Error("Simulated better-sqlite3 ABI mismatch");
err.code = "ERR_DLOPEN_FAILED";
throw err;
