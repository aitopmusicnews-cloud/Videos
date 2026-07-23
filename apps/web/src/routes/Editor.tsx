import { useEffect, useMemo } from "react";
import { useStore } from "../lib/store.js";
import { useKeyboardShortcuts } from "../lib/keyboard.js";
import { resumeInflightJobs } from "../lib/scheduler.js";
import { getWs } from "../lib/wavesurfer-ref.js";
import { Header } from "../components/Header.js";
import { LeftRail } from "../components/LeftRail.js";
import { RightSidebar } from "../components/RightSidebar.js";
import { Timeline } from "../components/Timeline.js";
import { TimelineDropzone } from "../components/TimelineDropzone.js";
import { VideoPreview } from "../components/VideoPreview.js";
import { Toasts } from "../components/Toasts.js";

export function Editor() {
  const analysis = useStore((s) => s.analysis);
  const clips = useStore((s) => s.clips);
  const selectedId = useStore((s) => s.selectedClipId);
  const selectClip = useStore((s) => s.selectClip);
  const togglePlay = useStore((s) => s.togglePlay);
  const splitAtPlayhead = useStore((s) => s.splitAtPlayhead);
  const mergeWithRight = useStore((s) => s.mergeWithRight);
  const selectedClip = clips.find((c) => c.id === selectedId);

  const zoomIn = useStore((s) => s.zoomIn);
  const zoomOut = useStore((s) => s.zoomOut);
  const zoomFit = useStore((s) => s.zoomFit);

  const setPlayhead = useStore((s) => s.setPlayhead);

  const shortcuts = useMemo(() => [
    { key: " ", handler: () => togglePlay() },
    { key: "Home", handler: () => { getWs()?.seekTo(0); setPlayhead(0); } },
    { key: "ArrowLeft", alt: true, handler: () => { getWs()?.seekTo(0); setPlayhead(0); } },
    { key: "Escape", handler: () => selectClip(null) },
    { key: "s", handler: () => { splitAtPlayhead(); } },
    { key: "S", handler: () => { splitAtPlayhead(); } },
    {
      key: "m",
      handler: () => {
        if (selectedClip) mergeWithRight(selectedClip.id);
      },
    },
    {
      key: "M",
      handler: () => {
        if (selectedClip) mergeWithRight(selectedClip.id);
      },
    },
    { key: "=", handler: () => zoomIn() },
    { key: "+", handler: () => zoomIn() },
    { key: "-", handler: () => zoomOut() },
    { key: "0", handler: () => zoomFit() },
  ], [togglePlay, setPlayhead, selectClip, splitAtPlayhead, selectedClip, mergeWithRight, zoomIn, zoomOut, zoomFit]);
  useKeyboardShortcuts(shortcuts);
  useEffect(() => { resumeInflightJobs(); }, []);

  return (
    <div className="app">
      <Header />
      <LeftRail />
      <main
        className="main"
        onClick={(e) => {
          if (e.target === e.currentTarget) selectClip(null);
        }}
      >
        <div className="preview">
          {analysis ? (
            <VideoPreview />
          ) : (
            <div className="preview-empty">
              <div className="label-big">no song loaded</div>
              <div>drop a song below to start</div>
            </div>
          )}
        </div>
      </main>
      <RightSidebar />
      {analysis ? <Timeline /> : <TimelineDropzone />}
      <Toasts />
    </div>
  );
}
