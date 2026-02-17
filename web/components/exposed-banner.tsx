"use client";

import { useEffect, useRef, useState } from "react";
import { getGatewayClient } from "../lib/gateway-client";

export function ExposedBanner() {
  const [isExposed, setIsExposed] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const checkExposed = async () => {
      try {
        const client = getGatewayClient();
        const health = await client.healthz();
        if (isMountedRef.current && health.is_exposed) {
          setIsExposed(true);
        }
      } catch {
        // Silently ignore — banner is non-critical
      }
    };
    checkExposed();
  }, []);

  if (!isExposed) {
    return null;
  }

  return (
    <div className="portal-exposed-banner" role="alert">
      <strong>Warning:</strong> This gateway is publicly exposed to the
      internet. Ensure authentication is enabled and secrets are rotated.
    </div>
  );
}
