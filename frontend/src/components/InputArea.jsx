import React, { useRef, useEffect, useState, useCallback } from "react";
import { useLang } from "../contexts/LangContext";
import VoiceInput from "./VoiceInput";
import "./InputArea.css";

export default function InputArea({ value, onChange, onSend, onStop, isGenerating, disabled, files, onFilesChange }) {
  const { t } = useLang();
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [previewFileIdx, setPreviewFileIdx] = useState(null);
  const [previewContent, setPreviewContent] = useState("");

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [value]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && (value.trim() || (files && files.length > 0))) {
        onSend();
      }
    }
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) {
      onFilesChange([...(files || []), ...selectedFiles]);
    }
    e.target.value = "";
  };

  const removeFile = (index) => {
    onFilesChange(files.filter((_, i) => i !== index));
    if (previewFileIdx === index) {
      setPreviewFileIdx(null);
      setPreviewContent("");
    } else if (previewFileIdx !== null && previewFileIdx > index) {
      setPreviewFileIdx(previewFileIdx - 1);
    }
  };

  const handleFilePreview = useCallback(async (index) => {
    if (previewFileIdx === index) {
      setPreviewFileIdx(null);
      setPreviewContent("");
      return;
    }
    const file = files[index];
    try {
      const text = await file.text();
      const truncated = text.length > 1000;
      setPreviewContent(truncated ? text.slice(0, 1000) + "\n\n" + t("previewTruncated") : text);
      setPreviewFileIdx(index);
    } catch (err) {
      console.error("File preview failed:", err);
      setPreviewContent("[Cannot read file]");
      setPreviewFileIdx(index);
    }
  }, [files, previewFileIdx]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      onFilesChange([...(files || []), ...droppedFiles]);
    }
  }, [files, onFilesChange]);

  return (
    <div className="input-area">
      <div
        className={`input-wrapper ${isDragging ? "drag-over" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="drop-overlay">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{t("dragDropHint")}</span>
          </div>
        )}
        {files && files.length > 0 && (
          <div className="input-files-preview">
            {files.map((file, i) => (
              <div key={i} className="input-file-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
                <span className="input-file-name">{file.name}</span>
                <button
                  className="file-preview-btn"
                  onClick={() => handleFilePreview(i)}
                  title={t("previewFile")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                <button className="input-file-remove" onClick={() => removeFile(i)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        {previewFileIdx !== null && files && files[previewFileIdx] && (
          <div className="file-preview-panel">
            <button className="file-preview-close" onClick={() => { setPreviewFileIdx(null); setPreviewContent(""); }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 11, color: "var(--text-muted)" }}>
              {files[previewFileIdx].name}
            </div>
            {previewContent}
          </div>
        )}
        <div className="input-container">
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title={t("uploadFile")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder={t("inputPlaceholder")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={disabled}
          />
          <VoiceInput
            onTranscript={(text) => onChange((value || "") + text)}
            disabled={disabled || isGenerating}
          />
          {isGenerating ? (
            <button className="stop-btn" onClick={onStop} title={t("cancel")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className="send-btn input-send-btn"
              onClick={onSend}
              disabled={(!value.trim() && (!files || files.length === 0)) || disabled}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
