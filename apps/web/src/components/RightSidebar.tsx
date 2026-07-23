import { useEffect, useState } from "react";
import { useStore } from "../lib/store.js";
import { Sidebar } from "./Sidebar.js";
import { SidebarEmpty } from "./SidebarEmpty.js";
import { Library } from "./Library.js";

type Tab = "ltx" | "library";

export function RightSidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const selectedClip = clips.find((clip) => clip.id === selectedId);
  const [tab, setTab] = useState<Tab>("ltx");

  useEffect(() => {
    if (selectedId) setTab("ltx");
  }, [selectedId]);

  const isEmpty = tab === "ltx" && !selectedClip;

  return (
    <aside className={`right${isEmpty ? " empty" : ""}`}>
      <div className="sidebar-tabs">
        <button
          type="button"
          className={`sidebar-tab${tab === "ltx" ? " active" : ""}`}
          onClick={() => setTab("ltx")}
        >
          LTX-2.3
        </button>
        <button
          type="button"
          className={`sidebar-tab${tab === "library" ? " active" : ""}`}
          onClick={() => setTab("library")}
        >
          Library
        </button>
      </div>

      <div className="sidebar-scroll">
        {tab === "library" ? <Library /> : selectedClip ? <Sidebar /> : <SidebarEmpty />}
      </div>
    </aside>
  );
}
