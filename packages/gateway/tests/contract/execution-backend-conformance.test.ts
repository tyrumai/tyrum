import { CLAUDE_AGENT_SDK_CONFORMANCE_FIXTURE } from "./execution-backend-conformance.claude-agent-sdk.js";
import {
  describeExecutionBackendConformance,
  describeNativeExecutionBackendConformanceGap,
} from "./execution-backend-conformance.js";

describeExecutionBackendConformance(CLAUDE_AGENT_SDK_CONFORMANCE_FIXTURE);
describeNativeExecutionBackendConformanceGap();
