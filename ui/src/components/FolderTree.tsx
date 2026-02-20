// ui/src/components/FolderTree.tsx

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";

interface IFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: IFileEntry[];
}

interface IFolderTreeProps {
  className?: string;
  rootPath?: string;
  onFileSelect?: (path: string) => void;
}

interface ITreeNodeProps {
  entry: IFileEntry;
  depth: number;
  onSelect?: (path: string) => void;
}

function TreeNode({ entry, depth, onSelect }: ITreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<IFileEntry[]>(entry.children || []);
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = useCallback(async () => {
    if (entry.is_dir) {
      if (!isExpanded && children.length === 0) {
        setIsLoading(true);
        try {
          // For now, we'll use a simple placeholder
          // In a full implementation, you'd call a Tauri command to list directory
          setChildren([]);
        } catch (e) {
          console.error("Failed to load directory:", e);
        }
        setIsLoading(false);
      }
      setIsExpanded(!isExpanded);
    } else {
      onSelect?.(entry.path);
    }
  }, [entry, isExpanded, children.length, onSelect]);

  const icon = entry.is_dir
    ? isExpanded
      ? "📂"
      : "📁"
    : getFileIcon(entry.name);

  return (
    <div>
      <button
        onClick={handleClick}
        className={clsx(
          "flex items-center gap-2 w-full px-2 py-1 text-left text-sm rounded",
          "hover:bg-[#1a1a1a] transition-colors",
          "text-gray-300 hover:text-white"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="text-xs w-4">
          {entry.is_dir && (isExpanded ? "▼" : "▶")}
        </span>
        <span>{icon}</span>
        <span className="truncate">{entry.name}</span>
        {isLoading && <span className="text-xs text-gray-500">...</span>}
      </button>

      {isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    md: "📝",
    txt: "📄",
    json: "📋",
    yaml: "⚙️",
    yml: "⚙️",
    ts: "🔷",
    tsx: "⚛️",
    js: "🟨",
    jsx: "⚛️",
    py: "🐍",
    rs: "🦀",
    go: "🔵",
    sh: "🐚",
    css: "🎨",
    html: "🌐",
  };
  return iconMap[ext || ""] || "📄";
}

export function FolderTree({
  className,
  rootPath = "~/docs",
  onFileSelect,
}: IFolderTreeProps) {
  const [rootEntries, setRootEntries] = useState<IFileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Placeholder entries for now
    // In full implementation, call Tauri command to list directory
    setRootEntries([
      {
        name: "notes",
        path: `${rootPath}/notes`,
        is_dir: true,
        children: [
          { name: "ideas.md", path: `${rootPath}/notes/ideas.md`, is_dir: false },
          { name: "todo.md", path: `${rootPath}/notes/todo.md`, is_dir: false },
        ],
      },
      {
        name: "projects",
        path: `${rootPath}/projects`,
        is_dir: true,
        children: [],
      },
      { name: "README.md", path: `${rootPath}/README.md`, is_dir: false },
    ]);
    setIsLoading(false);
  }, [rootPath]);

  return (
    <div className={clsx("flex flex-col", className)}>
      <div className="px-3 py-2 border-b border-[#2a2a2a]">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Documents
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {isLoading ? (
          <div className="px-4 py-2 text-sm text-gray-500">Loading...</div>
        ) : rootEntries.length === 0 ? (
          <div className="px-4 py-2 text-sm text-gray-500">No files found</div>
        ) : (
          rootEntries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              onSelect={onFileSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
