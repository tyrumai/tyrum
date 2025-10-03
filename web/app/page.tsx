import React from "react";

export default function Home() {
  return (
    <main className="container">
      <section>
        <h1>Tyrum Local Stack</h1>
        <p>
          The containerized development environment is running. Use this portal as
          the launch point for planner and policy tooling once the services land.
        </p>
      </section>
      <section>
        <h2>Next Steps</h2>
        <ul>
          <li>Connect to the Rust API at http://localhost:8080</li>
          <li>Inspect Postgres via localhost:5432 (user: tyrum)</li>
          <li>Exercise the mock LLM at http://localhost:8085/v1/completions</li>
        </ul>
      </section>
    </main>
  );
}
