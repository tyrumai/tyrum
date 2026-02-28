import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tyrum/operator-ui";
import { LogsContent } from "./Logs.js";
import { DiagnosticsContent } from "./Diagnostics.js";

type DebugTab = "logs" | "diagnostics";

export function DebugPage() {
  const [tab, setTab] = useState<DebugTab>("logs");

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Debug</h1>

      <Tabs value={tab} onValueChange={(value) => setTab(value as DebugTab)}>
        <TabsList>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>

        <TabsContent value="logs">
          <LogsContent />
        </TabsContent>

        <TabsContent value="diagnostics">
          <DiagnosticsContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}
