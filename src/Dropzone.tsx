import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";

export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

export const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  file: File | null;
  onFile: (file: File | null) => void;
  /** Shown above the file picker prompt. */
  label?: string;
}

/** Drag-and-drop target that also works by click or keyboard. Accepts a single PDF. */
export function Dropzone({ file, onFile, label = "Drop a PDF here" }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function take(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (!isPdf(f)) {
      setError("That isn't a PDF. Choose a .pdf file.");
      return;
    }
    setError(null);
    onFile(f);
  }

  const browse = () => input.current?.click();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      browse();
    }
  };

  return (
    <div>
      <div
        className={`dropzone ${over ? "over" : ""} ${file ? "has-file" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={file ? `Selected ${file.name}. Press to choose a different file` : label}
        onClick={browse}
        onKeyDown={onKey}
        onDragEnter={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          take(e.dataTransfer.files);
        }}
      >
        {file ? (
          <>
            <div className="dz-icon">📄</div>
            <div className="dz-file">
              <div className="dz-name">{file.name}</div>
              <div className="muted small">{formatSize(file.size)} · click or drop to choose a different file</div>
            </div>
            <button
              type="button"
              className="dz-remove"
              title="Remove file"
              aria-label="Remove file"
              onClick={(e) => {
                e.stopPropagation();
                setError(null);
                onFile(null);
                if (input.current) input.current.value = "";
              }}
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <div className="dz-title">{over ? "Release to add this PDF" : label}</div>
            <div className="muted small">or click to browse</div>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            take(e.target.files);
            e.target.value = ""; // allow choosing the same file again
          }}
        />
      </div>
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}
