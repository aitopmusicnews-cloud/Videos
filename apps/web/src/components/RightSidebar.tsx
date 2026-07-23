import { useState } from "react";
import { useStore } from "../lib/store.js";
import { Sidebar } from "./Sidebar.js";
import { SidebarEmpty } from "./SidebarEmpty.js";
import { ImageGenerator } from "./ImageGenerator.js";
import { Library } from "./Library.js";
import { toast } from "../lib/toast.js";

const LOOKBOOK_MAX = 16;

type Tab = "video" | "image" | "library";

export function RightSidebar() {
  const selectedId = useStore((s) => s.selectedClipId);
  const clips = useStore((s) => s.clips);
  const lookbook = useStore((s) => s.lookbook);
  const addLookbook = useStore((s) => s.addLookbook);
  const replaceLookbookUrl = useStore((s) => s.replaceLookbookUrl);

  const selectedClip = clips.find((c) => c.id === selectedId);
  const [tab, setTab] = useState<Tab>("video");

  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId && selectedId !== prevSelectedId) {
    setTab("video");
    setPrevSelectedId(selectedId);
  } else if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
  }

  const isEmpty = tab === "video" && !selectedClip;

  return (
    <aside className={`right${isEmpty ? " empty" : ""}`}>
      <div className="sidebar-tabs">
        <button
          type="button"
          className={`sidebar-tab${tab === "video" ? " active" : ""}`}
          onClick={() => setTab("video")}
        >
          Video
        </button>
        <button
          type="button"
          className={`sidebar-tab${tab === "image" ? " active" : ""}`}
          onClick={() => setTab("image")}
        >
          Image
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
        {tab === "library" ? (
          <Library />
        ) : tab === "image" ? (
          <ImageGenerator
            lookbook={lookbook}
            onDone={(url) => {
              if (lookbook.length < LOOKBOOK_MAX) {
                addLookbook(url);
              } else {
                toast.info("Lookbook full — image saved to library");
              }
            }}
            onRehosted={replaceLookbookUrl}
          />
        ) : selectedClip ? (
          <Sidebar />
        ) : (
          <SidebarEmpty />
        )}
      </div>
    </aside>
  );
}

