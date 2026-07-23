import { useState, useEffect, useRef } from "react";

export type JobStatus = "idle" | "pending" | "completed" | "failed";

export interface PollingState {
  status: JobStatus;
  videoUrl: string | null;
  error: string | null;
  isPolling: boolean;
}

interface UseJobPollingProps {
  jobId: string | null | undefined;
  intervalMs?: number; // Defaults to 3000ms
  onSuccess?: (videoUrl: string) => void;
  onFailure?: (error: string) => void;
}

export function useJobPolling({
  jobId,
  intervalMs = 3000,
  onSuccess,
  onFailure,
}: UseJobPollingProps): PollingState {
  const [status, setStatus] = useState<JobStatus>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  // Keep references to prevent calling stale callbacks if props change mid-poll
  const successRef = useRef(onSuccess);
  const failureRef = useRef(onFailure);

  useEffect(() => {
    successRef.current = onSuccess;
    failureRef.current = onFailure;
  }, [onSuccess, onFailure]);

  useEffect(() => {
    // If no jobId is provided, reset state and do not poll
    if (!jobId) {
      setStatus("idle");
      setVideoUrl(null);
      setError(null);
      setIsPolling(false);
      return;
    }

    setStatus("pending");
    setError(null);
    setIsPolling(true);

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    async function checkStatus() {
      try {
        // CLEANUP: Clean, standard tasks route - no openrouter prefix
        const response = await fetch(`/api/tasks/${jobId}`);
        
        if (!response.ok) {
          throw new Error(`Server responded with status ${response.status}`);
        }

        const data = await response.json();

        if (!isMounted) return;

        // "SUCCEEDED" maps to completed inside the openrouter.ts decoder handler
        if (data.status === "SUCCEEDED" && data.output && data.output[0]) {
          const completedUrl = data.output[0];
          setStatus("completed");
          setVideoUrl(completedUrl);
          setIsPolling(false);
          if (successRef.current) successRef.current(completedUrl);
        } else if (data.status === "FAILED") {
          const errMsg = data.error || "Inference execution failed on GPU cluster.";
          setStatus("failed");
          setError(errMsg);
          setIsPolling(false);
          if (failureRef.current) failureRef.current(errMsg);
        } else {
          // Still processing/pending/generating, wait and poll again
          timerId = setTimeout(checkStatus, intervalMs);
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error("[Polling Hook Error]:", err);
        
        // Retrying on network blips for resiliency
        timerId = setTimeout(checkStatus, intervalMs);
      }
    }

    // Begin the first status check
    checkStatus();

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [jobId, intervalMs]);

  return { status, videoUrl, error, isPolling };
}