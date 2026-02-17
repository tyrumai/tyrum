"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getGatewayClient, type CanvasMeta } from "../../../../lib/gateway-client";

export default function CanvasViewerPage() {
  const params = useParams<{ id: string }>();
  const canvasId = params.id;

  const [meta, setMeta] = useState<CanvasMeta | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadCanvas = useCallback(async () => {
    try {
      const client = getGatewayClient();
      const [metaData, htmlData] = await Promise.all([
        client.getCanvasMeta(canvasId),
        client.getCanvasHtml(canvasId),
      ]);
      if (isMountedRef.current) {
        setMeta(metaData);
        setHtml(htmlData);
        setError(null);
      }
    } catch (loadError) {
      if (isMountedRef.current) {
        const message =
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Unable to load canvas.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [canvasId]);

  useEffect(() => {
    loadCanvas();
  }, [loadCanvas]);

  return (
    <main className="portal-canvas" aria-labelledby="canvas-heading">
      <header className="portal-canvas__header">
        <div>
          <p className="portal-canvas__eyebrow">Portal</p>
          <h1 id="canvas-heading">Canvas Viewer</h1>
        </div>
        <Link href="/portal/canvas" className="portal-canvas__back-link">
          Back to canvas list
        </Link>
      </header>

      {error ? (
        <p
          className="portal-canvas__message portal-canvas__message--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <p className="portal-canvas__placeholder" role="status">
          Loading canvas...
        </p>
      ) : null}

      {!isLoading && meta ? (
        <section aria-label="Canvas details" className="portal-canvas__detail">
          <dl className="portal-canvas__meta">
            <div>
              <dt>Title</dt>
              <dd>{meta.title}</dd>
            </div>
            <div>
              <dt>Content Type</dt>
              <dd>{meta.content_type}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                <time dateTime={meta.created_at}>
                  {new Date(meta.created_at).toLocaleString()}
                </time>
              </dd>
            </div>
          </dl>

          {html !== null ? (
            <div className="portal-canvas__frame-wrapper">
              <iframe
                className="portal-canvas__frame"
                title={meta.title}
                sandbox="allow-same-origin"
                srcDoc={html}
              />
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
