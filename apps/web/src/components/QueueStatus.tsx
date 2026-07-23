import { useStore } from "../lib/store.js";
import { MAX_CONCURRENT, cancelJob } from "../lib/scheduler.js";

/**
 * Small queue status chip. Renders nothing if the queue is empty.
 * Lives in the header so it's always visible.
 */
export function QueueStatus() {
  const jobs = useStore((s) => s.jobs);
  const running = jobs.filter((j) => j.state === "running");
  const queued = jobs.filter((j) => j.state === "queued");
  const total = running.length + queued.length;

  if (total === 0) return null;

  return (
    <div className="queue-chip" title={`${running.length} running (cap ${MAX_CONCURRENT}), ${queued.length} queued`}>
      <span className="queue-pulse" />
      <span className="queue-text">
        {running.length} running
        {queued.length > 0 ? ` · ${queued.length} queued` : ""}
      </span>
      <button
        type="button"
        className="queue-cancel"
        title="cancel all queued"
        onClick={() => {
          for (const j of queued) cancelJob(j.id);
        }}
      >
        clear queue
      </button>
    </div>
  );
}
