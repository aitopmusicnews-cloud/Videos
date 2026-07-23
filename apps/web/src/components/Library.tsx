import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../lib/store.js";
import { toast } from "../lib/toast.js";
import { getErrorMessage } from "@mvs/shared";
import {
  listProjects,
  loadProjectFromServer,
  deleteProjectOnServer,
  listRenders,
  listSavedClips,
  deleteClipOnServer,
  listSavedImages,
  deleteImageFromLibrary,
  listLibraryFolders,
  saveLibraryFolder,
  deleteLibraryFolder,
  uploadImage,
  uploadVideo,
  saveImageToLibrary,
  saveClipToServer,
  type ProjectMeta,
  type RenderEntry,
  type SavedClip,
  type SavedImage,
  type LibraryFolder,
} from "../lib/api.js";
import { downloadFromUrl } from "../lib/download.js";

type Tab = "projects" | "clips" | "images" | "renders";

const randomId = () => "lib_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now().toString(36);

const getVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = URL.createObjectURL(file);
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(video.src);
      resolve(5.0);
    }, 2000);
    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(video.src);
      resolve(video.duration || 5.0);
    };
    video.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(video.src);
      resolve(5.0);
    };
  });
};

const isVideoFile = (file: File): boolean => {
  if (file.type && file.type.startsWith("video/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && ["mp4", "webm", "ogg", "mov", "avi", "mkv", "m4v"].includes(ext);
};

const isImageFile = (file: File): boolean => {
  if (file.type && file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tiff", "jfif"].includes(ext);
};

export function Library({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [clips, setClips] = useState<SavedClip[] | null>(null);
  const [images, setImages] = useState<SavedImage[] | null>(null);
  const [renders, setRenders] = useState<RenderEntry[] | null>(null);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  
  const [currentClipsFolderId, setCurrentClipsFolderId] = useState<string | null>(null);
  const [currentImagesFolderId, setCurrentImagesFolderId] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const restoreSnapshot = useStore((s) => s.restoreSnapshot);
  const updateClip = useStore((s) => s.updateClip);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const addLookbook = useStore((s) => s.addLookbook);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      listProjects().catch((err) => { console.error("listProjects failed", err); return []; }),
      listSavedClips().catch((err) => { console.error("listSavedClips failed", err); return []; }),
      listSavedImages().catch((err) => { console.error("listSavedImages failed", err); return []; }),
      listRenders().catch((err) => { console.error("listRenders failed", err); return []; }),
      listLibraryFolders().catch((err) => { console.error("listLibraryFolders failed", err); return []; }),
    ])
      .then(([p, c, i, r, f]) => {
        setProjects(p);
        setClips(c);
        setImages(i);
        setRenders(r);
        setFolders(f);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onLoad = async (id: string) => {
    if (!confirm("Load this project? Current unsaved work will be lost.")) return;
    try {
      const saved = await loadProjectFromServer(id);
      restoreSnapshot(saved.state);
      onClose();
      toast.success(`Loaded "${saved.name}"`);
    } catch (err) {
      toast.error(`Failed to load: ${getErrorMessage(err)}`);
    }
  };

  const onDeleteProject = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await deleteProjectOnServer(id);
      setProjects((prev) => prev?.filter((p) => p.id !== id) ?? []);
      toast.success("Project deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${getErrorMessage(err)}`);
    }
  };

  const onUseClip = (clip: SavedClip) => {
    if (!selectedClipId) {
      toast.warning("Select a clip on the timeline first, then use a saved clip");
      return;
    }
    updateClip(selectedClipId, {
      source: "library",
      videoUrl: clip.videoUrl,
      status: "ready",
      lastError: undefined,
      generationTaskId: undefined,
      prompt: clip.prompt ?? undefined,
    });
    onClose();
    toast.success(`Applied "${clip.name}" to selected clip`);
  };

  const onDeleteClip = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteClipOnServer(id);
      setClips((prev) => prev?.filter((c) => c.id !== id) ?? []);
      toast.success("Clip deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${getErrorMessage(err)}`);
    }
  };

  const onUseImage = (image: SavedImage) => {
    addLookbook(image.url);
    onClose();
    toast.success(`Added "${image.name || "image"}" to lookbook`);
  };

  const onDeleteImage = async (id: string, name: string) => {
    if (!confirm(`Delete "${name || "image"}"? This won't affect lookbook tiles already using it.`)) return;
    try {
      await deleteImageFromLibrary(id);
      setImages((prev) => prev?.filter((i) => i.id !== id) ?? []);
      toast.success("Image deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${getErrorMessage(err)}`);
    }
  };

  // Folder Actions
  const handleCreateFolder = async () => {
    const name = prompt("Enter new folder name:");
    if (!name || !name.trim()) return;

    try {
      setLoading(true);
      const activeFolderId = tab === "clips" ? currentClipsFolderId : currentImagesFolderId;
      const newFolder = await saveLibraryFolder({
        id: randomId(),
        name: name.trim(),
        parentId: activeFolderId,
        type: tab as "clips" | "images",
      });
      setFolders((prev) => [...prev, newFolder]);
      toast.success(`Created folder "${name}"`);
    } catch (err) {
      toast.error(`Failed to create folder: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteFolderRecursively = async (folderId: string) => {
    // 1. Recursive subfolders
    const childFolders = folders.filter((f) => f.parentId === folderId);
    for (const child of childFolders) {
      await deleteFolderRecursively(child.id);
    }
    // 2. Clips inside this folder
    const folderClips = clips?.filter((c) => c.folderId === folderId) ?? [];
    for (const c of folderClips) {
      await deleteClipOnServer(c.id);
    }
    // 3. Images inside this folder
    const folderImages = images?.filter((i) => i.folderId === folderId) ?? [];
    for (const img of folderImages) {
      await deleteImageFromLibrary(img.id);
    }
    // 4. Delete the folder itself
    await deleteLibraryFolder(folderId);
  };

  const onDeleteFolder = async (folderId: string, name: string) => {
    if (!confirm(`Delete folder "${name}" and all of its contents recursively?`)) return;
    try {
      setLoading(true);
      await deleteFolderRecursively(folderId);
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      // Remove deleted elements from view
      setClips((prev) => prev?.filter((c) => c.folderId !== folderId) ?? []);
      setImages((prev) => prev?.filter((i) => i.folderId !== folderId) ?? []);
      toast.success(`Deleted folder "${name}"`);
    } catch (err) {
      toast.error(`Failed to delete folder: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // Upload Logic
  const uploadSingleFile = async (file: File, folderId: string | null): Promise<boolean> => {
    if (tab === "clips") {
      if (!isVideoFile(file)) {
        toast.warning(`Skipped non-video file: ${file.name}`);
        return false;
      }
      const duration = await getVideoDuration(file);
      const { url } = await uploadVideo(file);
      await saveClipToServer({
        id: randomId(),
        name: file.name,
        videoUrl: url,
        source: "uploaded",
        prompt: null,
        duration,
        sectionLabel: null,
        folderId,
      });
      return true;
    } else if (tab === "images") {
      if (!isImageFile(file)) {
        toast.warning(`Skipped non-image file: ${file.name}`);
        return false;
      }
      const { url } = await uploadImage(file);
      await saveImageToLibrary({
        id: randomId(),
        name: file.name,
        url,
        source: "uploaded",
        prompt: null,
        model: null,
        folderId,
      });
      return true;
    }
    return false;
  };

  const handleFilesUpload = async (filesToUpload: { file: File; relativePath: string }[]) => {
    setLoading(true);
    let successCount = 0;
    let failCount = 0;

    try {
      const activeFolderId = tab === "clips" ? currentClipsFolderId : currentImagesFolderId;

      for (const { file, relativePath } of filesToUpload) {
        try {
          let fileFolderId = activeFolderId;
          const pathParts = relativePath.split("/");
          
          if (pathParts.length > 1) {
            const folderParts = pathParts.slice(0, -1);
            let currentParentId = activeFolderId;
            
            for (const part of folderParts) {
              let existing = folders.find(
                (f) => f.name === part && (f.parentId || null) === (currentParentId || null) && f.type === tab
              );
              if (!existing) {
                const newFolderId = randomId();
                existing = await saveLibraryFolder({
                  id: newFolderId,
                  name: part,
                  parentId: currentParentId,
                  type: tab as "clips" | "images",
                });
                setFolders((prev) => [...prev, existing!]);
                folders.push(existing);
              }
              currentParentId = existing.id;
            }
            fileFolderId = currentParentId;
          }

          const uploaded = await uploadSingleFile(file, fileFolderId);
          if (uploaded) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (err) {
          console.error("Failed to upload file:", file.name, err);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully uploaded ${successCount} files`);
      }
      if (failCount > 0) {
        toast.error(`Failed to upload ${failCount} files`);
      }
      refresh();
    } catch (err) {
      toast.error(`Upload error: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (tab !== "clips" && tab !== "images") return;

    const items = e.dataTransfer.items;
    if (!items) return;

    setLoading(true);
    const filesWithPaths: { file: File; relativePath: string }[] = [];

    const traverseEntry = async (entry: any, path = "") => {
      try {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
          filesWithPaths.push({ file, relativePath: path + file.name });
        } else if (entry.isDirectory) {
          const dirReader = entry.createReader();
          const readEntries = async (): Promise<any[]> => {
            return new Promise((resolve) => {
              dirReader.readEntries(resolve);
            });
          };
          const childEntries = await readEntries();
          for (const child of childEntries) {
            await traverseEntry(child, path + entry.name + "/");
          }
        }
      } catch (err) {
        console.error("Failed to traverse entry:", entry, err);
      }
    };

    const promises = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const entry = item ? item.webkitGetAsEntry() : null;
      if (entry) {
        promises.push(traverseEntry(entry));
      }
    }

    await Promise.all(promises);
    setLoading(false);

    if (filesWithPaths.length > 0) {
      await handleFilesUpload(filesWithPaths);
    } else {
      const rawFiles = Array.from(e.dataTransfer.files);
      if (rawFiles.length > 0) {
        await handleFilesUpload(rawFiles.map((f) => ({ file: f, relativePath: f.name })));
      }
    }
  };

  const handleFileSelectionChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    const filesArray = Array.from(selectedFiles);
    await handleFilesUpload(filesArray.map((f) => ({ file: f, relativePath: f.name })));
    e.target.value = "";
  };

  const handleFolderSelectionChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    const filesArray = Array.from(selectedFiles);
    await handleFilesUpload(
      filesArray.map((f) => ({
        file: f,
        relativePath: f.webkitRelativePath || f.name,
      }))
    );
    e.target.value = "";
  };

  // Breadcrumbs Helper
  const getBreadcrumbs = () => {
    const activeFolderId = tab === "clips" ? currentClipsFolderId : currentImagesFolderId;
    const path: LibraryFolder[] = [];
    let curr = activeFolderId;
    while (curr) {
      const f = folders.find((fol) => fol.id === curr);
      if (f) {
        path.unshift(f);
        curr = f.parentId;
      } else {
        break;
      }
    }
    return path;
  };

  const breadcrumbs = getBreadcrumbs();
  const setFolderId = (id: string | null) => {
    if (tab === "clips") {
      setCurrentClipsFolderId(id);
    } else if (tab === "images") {
      setCurrentImagesFolderId(id);
    }
  };

  const isUploadableTab = tab === "clips" || tab === "images";

  const modalContent = (
    <div className={`library-modal ${onClose ? "max-w-4xl w-[90vw] h-[80vh] shadow-2xl" : "w-full min-h-[500px]"} flex flex-col bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden text-white`}>
      <div className="library-header flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900">
        <div className="library-tabs flex gap-2">
          {(["projects", "clips", "images", "renders"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`library-tab px-3 py-1.5 rounded text-sm transition-all capitalize ${
                tab === t
                  ? "bg-zinc-800 text-white font-medium shadow-inner"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900"
              }`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            type="button"
            className="library-close text-zinc-400 hover:text-white text-xl p-1 transition-colors"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>

        {/* Action Controls & Navigation bar */}
        {isUploadableTab && (
          <div className="px-5 py-3 border-b border-zinc-900 bg-zinc-950 flex flex-wrap items-center justify-between gap-3">
            {/* Breadcrumbs */}
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 select-none">
              <button
                type="button"
                className="hover:text-amber-400 font-medium transition-colors"
                onClick={() => setFolderId(null)}
              >
                Root
              </button>
              {breadcrumbs.map((bc) => (
                <span key={bc.id} className="flex items-center gap-1.5">
                  <span className="text-zinc-700">/</span>
                  <button
                    type="button"
                    className="hover:text-amber-400 transition-colors"
                    onClick={() => setFolderId(bc.id)}
                  >
                    {bc.name}
                  </button>
                </span>
              ))}
            </div>

            {/* Folder & Upload buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn text-xs py-1 px-2.5 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-1"
                onClick={handleCreateFolder}
              >
                📁 New Folder
              </button>
              <button
                type="button"
                className="btn text-xs py-1 px-2.5 bg-amber-500 text-black hover:bg-amber-400 font-medium flex items-center gap-1"
                onClick={() => fileInputRef.current?.click()}
              >
                📤 Upload Files
              </button>
              <button
                type="button"
                className="btn text-xs py-1 px-2.5 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white flex items-center gap-1"
                onClick={() => folderInputRef.current?.click()}
              >
                📁 Upload Folder
              </button>
              
              {/* Hidden Standard File Selector inputs */}
              <input
                type="file"
                ref={fileInputRef}
                hidden
                multiple
                accept={tab === "clips" ? "video/*" : "image/*"}
                onChange={handleFileSelectionChange}
              />
              <input
                type="file"
                ref={folderInputRef}
                hidden
                multiple
                {...({ webkitdirectory: "", directory: "" } as any)}
                onChange={handleFolderSelectionChange}
              />
            </div>
          </div>
        )}

        {/* Drag & Drop target container */}
        <div
          className="relative flex-1 overflow-y-auto p-5 bg-zinc-950 min-h-[300px]"
          onDragOver={(e) => {
            e.preventDefault();
            if (isUploadableTab) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 bg-zinc-950/90 border-2 border-dashed border-amber-500/50 flex flex-col items-center justify-center z-50 transition-all pointer-events-none">
              <span className="text-4xl mb-3">📥</span>
              <p className="text-base font-semibold text-white">Drop folders or files here to upload</p>
              <p className="text-xs text-zinc-500 mt-1">They will be automatically organized into the current folder</p>
            </div>
          )}

          {loading ? (
            <div className="library-empty flex flex-col items-center justify-center py-20 text-zinc-400">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mb-3" />
              <span>Processing and uploading...</span>
            </div>
          ) : tab === "projects" ? (
            <ProjectsTab
              projects={projects ?? []}
              onLoad={onLoad}
              onDelete={onDeleteProject}
            />
          ) : tab === "clips" ? (
            <ClipsTab
              clips={clips ?? []}
              currentFolderId={currentClipsFolderId}
              folders={folders}
              onEnterFolder={setFolderId}
              onDeleteFolder={onDeleteFolder}
              onUse={onUseClip}
              onDelete={onDeleteClip}
              hasSelection={!!selectedClipId}
            />
          ) : tab === "images" ? (
            <ImagesTab
              images={images ?? []}
              currentFolderId={currentImagesFolderId}
              folders={folders}
              onEnterFolder={setFolderId}
              onDeleteFolder={onDeleteFolder}
              onUse={onUseImage}
              onDelete={onDeleteImage}
            />
          ) : (
            <RendersTab renders={renders ?? []} />
          )}
        </div>
      </div>
  );

  if (onClose) {
    return (
      <div
        className="library-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {modalContent}
      </div>
    );
  }

  return modalContent;
}

function ProjectsTab({
  projects,
  onLoad,
  onDelete,
}: {
  projects: ProjectMeta[];
  onLoad: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (!projects.length) {
    return <div className="library-empty">No saved projects yet. Hit Save to keep your work.</div>;
  }

  return (
    <div className="library-grid">
      {projects.map((p) => (
        <div key={p.id} className="library-card">
          {p.thumbnailUrl ? (
            <video
              className="library-card-thumb"
              src={p.thumbnailUrl}
              muted
              playsInline
              preload="metadata"
              onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
              onMouseLeave={(e) => {
                const v = e.currentTarget as HTMLVideoElement;
                v.pause();
                v.currentTime = 0;
              }}
            />
          ) : (
            <div className="library-card-thumb" />
          )}
          <div className="library-card-info">
            <div className="library-card-name">{p.name}</div>
            <div className="library-card-date">
              {new Date(p.savedAt).toLocaleDateString()} {new Date(p.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <div className="library-card-actions">
            <button type="button" className="btn" onClick={() => onLoad(p.id)}>Open</button>
            <button type="button" className="btn ghost" onClick={() => onDelete(p.id, p.name)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClipsTab({
  clips,
  currentFolderId,
  folders,
  onEnterFolder,
  onDeleteFolder,
  onUse,
  onDelete,
  hasSelection,
}: {
  clips: SavedClip[];
  currentFolderId: string | null;
  folders: LibraryFolder[];
  onEnterFolder: (id: string | null) => void;
  onDeleteFolder: (id: string, name: string) => void;
  onUse: (clip: SavedClip) => void;
  onDelete: (id: string, name: string) => void;
  hasSelection: boolean;
}) {
  const activeFolders = folders.filter((f) => f.type === "clips" && (f.parentId || null) === (currentFolderId || null));
  const activeClips = clips.filter((c) => (c.folderId || null) === (currentFolderId || null));

  if (!activeFolders.length && !activeClips.length) {
    return (
      <div className="library-empty flex flex-col items-center justify-center py-20 text-zinc-500">
        <span className="text-3xl mb-2">📂</span>
        <span>This folder is empty. Drag files or folders here, or click upload to add clips.</span>
      </div>
    );
  }

  return (
    <div className="library-grid">
      {/* List Folders first */}
      {activeFolders.map((fol) => (
        <div key={fol.id} className="library-card group hover:border-zinc-500 transition-all bg-zinc-900/50">
          <div 
            className="library-card-thumb flex items-center justify-center bg-zinc-800 text-3xl select-none cursor-pointer"
            onClick={() => onEnterFolder(fol.id)}
          >
            📁
          </div>
          <div className="library-card-info cursor-pointer flex-1 py-1" onClick={() => onEnterFolder(fol.id)}>
            <div className="library-card-name text-white font-medium hover:text-amber-400 transition-colors">
              {fol.name}
            </div>
            <div className="library-card-date text-xs text-zinc-500">Folder</div>
          </div>
          <div className="library-card-actions opacity-80 group-hover:opacity-100 transition-opacity">
            <button type="button" className="btn" onClick={() => onEnterFolder(fol.id)}>
              Open
            </button>
            <button
              type="button"
              className="btn ghost text-red-400 hover:text-red-300 transition-colors"
              onClick={() => onDeleteFolder(fol.id, fol.name)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {/* List Clips */}
      {activeClips.map((c) => (
        <div key={c.id} className="library-card">
          <video
            className="library-card-thumb"
            src={c.videoUrl}
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
          />
          <div className="library-card-info">
            <div className="library-card-name">{c.name}</div>
            <div className="library-card-date">
              {c.duration.toFixed(1)}s · {c.source}
              {c.sectionLabel ? ` · ${c.sectionLabel}` : ""}
            </div>
          </div>
          <div className="library-card-actions">
            <button
              type="button"
              className="btn"
              onClick={() => onUse(c)}
              title={hasSelection ? "Apply to selected timeline clip" : "Select a timeline clip first"}
              disabled={!hasSelection}
            >
              Use
            </button>
            <a href={c.videoUrl} target="_blank" rel="noreferrer" className="btn ghost">View</a>
            <button type="button" className="btn ghost" onClick={() => onDelete(c.id, c.name)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ImagesTab({
  images,
  currentFolderId,
  folders,
  onEnterFolder,
  onDeleteFolder,
  onUse,
  onDelete,
}: {
  images: SavedImage[];
  currentFolderId: string | null;
  folders: LibraryFolder[];
  onEnterFolder: (id: string | null) => void;
  onDeleteFolder: (id: string, name: string) => void;
  onUse: (image: SavedImage) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);

  const activeFolders = folders.filter((f) => f.type === "images" && (f.parentId || null) === (currentFolderId || null));
  const activeImages = images.filter((i) => (i.folderId || null) === (currentFolderId || null));

  if (!activeFolders.length && !activeImages.length) {
    return (
      <div className="library-empty flex flex-col items-center justify-center py-20 text-zinc-500">
        <span className="text-3xl mb-2">📂</span>
        <span>This folder is empty. Drag files or folders here, or click upload to add images.</span>
      </div>
    );
  }

  const onDownload = async (img: SavedImage) => {
    setDownloading(img.id);
    const fallback = img.url.split("/").pop()?.split("?")[0] || "image.png";
    const filename = img.name ? `${img.name.slice(0, 40).replace(/[^a-zA-Z0-9._-]/g, "_")}.png` : fallback;
    try {
      await downloadFromUrl(img.url, filename);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="library-grid">
      {/* List Folders first */}
      {activeFolders.map((fol) => (
        <div key={fol.id} className="library-card group hover:border-zinc-500 transition-all bg-zinc-900/50">
          <div 
            className="library-card-thumb flex items-center justify-center bg-zinc-800 text-3xl select-none cursor-pointer"
            onClick={() => onEnterFolder(fol.id)}
          >
            📁
          </div>
          <div className="library-card-info cursor-pointer flex-1 py-1" onClick={() => onEnterFolder(fol.id)}>
            <div className="library-card-name text-white font-medium hover:text-amber-400 transition-colors">
              {fol.name}
            </div>
            <div className="library-card-date text-xs text-zinc-500">Folder</div>
          </div>
          <div className="library-card-actions opacity-80 group-hover:opacity-100 transition-opacity">
            <button type="button" className="btn" onClick={() => onEnterFolder(fol.id)}>
              Open
            </button>
            <button
              type="button"
              className="btn ghost text-red-400 hover:text-red-300 transition-colors"
              onClick={() => onDeleteFolder(fol.id, fol.name)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {/* List Images */}
      {activeImages.map((img) => (
        <div key={img.id} className="library-card">
          <div
            className="library-card-thumb"
            style={{ backgroundImage: `url(${img.url})` }}
          />
          <div className="library-card-info">
            <div className="library-card-name">{img.name || "untitled"}</div>
            <div className="library-card-date">
              {img.source}{img.model ? ` · ${img.model}` : ""} ·{" "}
              {new Date(img.savedAt).toLocaleDateString()}
            </div>
          </div>
          <div className="library-card-actions">
            <button type="button" className="btn" onClick={() => onUse(img)}>
              Add to lookbook
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onDownload(img)}
              disabled={downloading === img.id}
            >
              {downloading === img.id ? "…" : "Download"}
            </button>
            <button type="button" className="btn ghost" onClick={() => onDelete(img.id, img.name)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RendersTab({ renders }: { renders: RenderEntry[] }) {
  const [downloading, setDownloading] = useState<string | null>(null);

  if (!renders.length) {
    return <div className="library-empty">No renders yet. Export an MP4 from the editor.</div>;
  }

  const onDownload = async (r: RenderEntry) => {
    setDownloading(r.name);
    try {
      await downloadFromUrl(r.url, r.name);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="library-grid">
      {renders.map((r) => (
        <div key={r.name} className="library-card">
          <video
            className="library-card-thumb"
            src={r.url}
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
          />
          <div className="library-card-info">
            <div className="library-card-name">{r.name}</div>
            <div className="library-card-date">
              {formatSize(r.size)} · {new Date(r.modifiedAt).toLocaleDateString()}
            </div>
          </div>
          <div className="library-card-actions">
            <a href={r.url} target="_blank" rel="noreferrer" className="btn">View</a>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onDownload(r)}
              disabled={downloading === r.name}
              title="Save MP4 to your computer"
            >
              {downloading === r.name ? "Downloading…" : "Download"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
