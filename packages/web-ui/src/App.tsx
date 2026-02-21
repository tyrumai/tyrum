import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { Layout } from "./components/Layout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Activity } from "./pages/Activity.js";
import { ApprovalList } from "./pages/ApprovalList.js";
import { ApprovalDetail } from "./pages/ApprovalDetail.js";
import { PlanTimeline } from "./pages/PlanTimeline.js";
import { Playbooks } from "./pages/Playbooks.js";
import { Watchers } from "./pages/Watchers.js";
import { CanvasList } from "./pages/CanvasList.js";
import { CanvasDetail } from "./pages/CanvasDetail.js";
import { Settings } from "./pages/Settings.js";
import { Linking } from "./pages/Linking.js";
import { OnboardingStart } from "./pages/OnboardingStart.js";
import { OnboardingPersona } from "./pages/OnboardingPersona.js";
import { OnboardingConsent } from "./pages/OnboardingConsent.js";
import { Presence } from "./pages/Presence.js";
import { Usage } from "./pages/Usage.js";
import { Context } from "./pages/Context.js";
import { ContextDetail } from "./pages/ContextDetail.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/app" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="approvals" element={<ApprovalList />} />
          <Route path="approvals/:id" element={<ApprovalDetail />} />
          <Route path="activity" element={<Activity />} />
          <Route path="plans/:planId/timeline" element={<PlanTimeline />} />
          <Route path="playbooks" element={<Playbooks />} />
          <Route path="watchers" element={<Watchers />} />
          <Route path="canvas" element={<CanvasList />} />
          <Route path="canvas/:id" element={<CanvasDetail />} />
          <Route path="settings" element={<Settings />} />
          <Route path="linking" element={<Linking />} />
          <Route path="onboarding/start" element={<OnboardingStart />} />
          <Route path="onboarding/persona" element={<OnboardingPersona />} />
          <Route path="onboarding/consent" element={<OnboardingConsent />} />
          <Route path="presence" element={<Presence />} />
          <Route path="usage" element={<Usage />} />
          <Route path="context" element={<Context />} />
          <Route path="context/:runId" element={<ContextDetail />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
