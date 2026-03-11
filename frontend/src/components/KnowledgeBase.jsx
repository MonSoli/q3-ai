import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LangContext";
import { fetchKBFolders, createKBFolder, renameKBFolder, deleteKBFolder, moveKBDocument, analyzeDocument, getDocumentAnalytics } from "../utils/api";
import { API_BASE } from "../config";
import "./KnowledgeBase.css";

export default function KnowledgeBase({ isFullPage, onClose }) {
  const { token } = useAuth();
  const { t } = useLang();
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [error, setError] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [docAnalytics, setDocAnalytics] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: null, name: t("rootFolder") }]);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragFileCounter = useRef(0);

  const fileInputRef = useRef(null);

  const loadContents = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [foldersData, docsResponse] = await Promise.all([
        fetchKBFolders(currentFolderId),
        fetch(
          currentFolderId
            ? `${API_BASE}/api/knowledge/documents?folder_id=${currentFolderId}`
            : `${API_BASE}/api/knowledge/documents`,
          { headers: { Authorization: `Bearer ${token}` } }
        ),
      ]);
      setFolders(foldersData || []);
      if (docsResponse.ok) {
        setDocuments(await docsResponse.json());
      }
    } catch (err) {
      console.error("Failed to load KB contents:", err);
      setError(t("error") + ": " + t("loading"));
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, token, t]);

  useEffect(() => {
    loadContents();
  }, [loadContents]);
  const openFolder = (folder) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateToFolder = (folderId, index) => {
    setCurrentFolderId(folderId);
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await createKBFolder(newFolderName.trim(), currentFolderId);
      setCreateFolderOpen(false);
      setNewFolderName("");
      loadContents();
    } catch (err) {
      setError(err.message);
    }
  };
  const handleRenameFolder = async () => {
    if (!renameValue.trim() || !renamingFolder) return;
    try {
      await renameKBFolder(renamingFolder.id, renameValue.trim());
      setRenamingFolder(null);
      setRenameValue("");
      loadContents();
      setBreadcrumbs((prev) =>
        prev.map((b) => (b.id === renamingFolder.id ? { ...b, name: renameValue.trim() } : b))
      );
    } catch (err) {
      setError(err.message);
    }
  };
  const handleDeleteFolder = async (folderId) => {
    if (!window.confirm(t("delete") + "?")) return;
    try {
      await deleteKBFolder(folderId);
      loadContents();
    } catch (err) {
      setError(err.message);
    }
  };
  const handleGlobalDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragFileCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingFile(true);
    }
  }, []);

  const handleGlobalDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragFileCounter.current--;
    if (dragFileCounter.current === 0) {
      setIsDraggingFile(false);
    }
  }, []);

  const handleGlobalDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const uploadFiles = useCallback(async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError("");
    for (const file of fileList) {
      const formData = new FormData();
      formData.append("file", file);
      if (currentFolderId) {
        formData.append("folder_id", currentFolderId);
      }
      try {
        const response = await fetch(`${API_BASE}/api/knowledge/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.detail || t("error"));
        }
      } catch (err) {
        setError(t("error") + ` (${file.name}): ${err.message}`);
      }
    }
    setUploading(false);
    loadContents();
  }, [currentFolderId, token, t, loadContents]);

  const handleGlobalDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    dragFileCounter.current = 0;
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      uploadFiles(droppedFiles);
    }
  }, [uploadFiles]);

  useEffect(() => {
    const el = document.documentElement;
    el.addEventListener("dragenter", handleGlobalDragEnter);
    el.addEventListener("dragleave", handleGlobalDragLeave);
    el.addEventListener("dragover", handleGlobalDragOver);
    el.addEventListener("drop", handleGlobalDrop);
    return () => {
      el.removeEventListener("dragenter", handleGlobalDragEnter);
      el.removeEventListener("dragleave", handleGlobalDragLeave);
      el.removeEventListener("dragover", handleGlobalDragOver);
      el.removeEventListener("drop", handleGlobalDrop);
    };
  }, [handleGlobalDragEnter, handleGlobalDragLeave, handleGlobalDragOver, handleGlobalDrop]);
  const handleUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");

    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      if (currentFolderId) {
        formData.append("folder_id", currentFolderId);
      }
      try {
        const response = await fetch(`${API_BASE}/api/knowledge/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.detail || t("error"));
        }
      } catch (err) {
        setError(t("error") + ` (${file.name}): ${err.message}`);
      }
    }
    setUploading(false);
    loadContents();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAnalyzeDocument = async (doc) => {
    setAnalyzing(true);
    setDocAnalytics(null);
    try {
      const result = await analyzeDocument(doc.id);
      setDocAnalytics(result);
    } catch (err) {
      console.error("Analysis failed:", err);
      setError("Ошибка анализа документа");
    }
    setAnalyzing(false);
  };

  const handleOpenDocument = async (doc) => {
    setSelectedDoc(doc);
    setViewerOpen(true);
    setEditMode(false);
    setEditContent("");
    setDocAnalytics(null);
    try {
      const response = await fetch(`${API_BASE}/api/knowledge/documents/${doc.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const fullDoc = await response.json();
        setSelectedDoc(fullDoc);
        setEditContent(fullDoc.content || "");
      }
    } catch (err) {
      console.error("Failed to load document:", err);
      setEditContent(doc.content || "");
    }
  };

  const handleSaveDocument = async () => {
    if (!selectedDoc) return;
    try {
      const response = await fetch(`${API_BASE}/api/knowledge/documents/${selectedDoc.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (response.ok) {
        setEditMode(false);
        loadContents();
        setSelectedDoc({ ...selectedDoc, content: editContent });
      }
    } catch (err) {
      console.error("Failed to save document:", err);
      setError(t("error"));
    }
  };

  const handleDeleteDocument = async (docId) => {
    if (!window.confirm(t("delete") + "?")) return;
    try {
      const response = await fetch(`${API_BASE}/api/knowledge/documents/${docId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        loadContents();
        if (selectedDoc?.id === docId) {
          setViewerOpen(false);
          setSelectedDoc(null);
        }
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
      setError(t("error"));
    }
  };

  const handleCopyDocument = async (doc) => {
    try {
      const response = await fetch(`${API_BASE}/api/knowledge/documents/${doc.id}/copy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) loadContents();
    } catch (err) {
      console.error("Failed to copy document:", err);
      setError(t("error"));
    }
  };
  const handleDocDragStart = (e, docId) => {
    e.dataTransfer.setData("text/plain", docId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleFolderDragOver = (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverFolderId(folderId);
  };

  const handleFolderDragLeave = (e) => {
    e.preventDefault();
    setDragOverFolderId(null);
  };

  const handleFolderDrop = async (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
    const docId = e.dataTransfer.getData("text/plain");
    if (docId) {
      try {
        await moveKBDocument(docId, folderId);
        loadContents();
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const getFileIcon = (filename) => {
    const ext = filename.split(".").pop().toLowerCase();
    if (["pdf"].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 15h6M9 11h6" />
        </svg>
      );
    }
    if (["doc", "docx"].includes(ext)) {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M16 13H8M16 17H8M10 9H8" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  };

  const totalItems = folders.length + documents.length;

  return (
    <div className={`kb-page ${isFullPage ? "full-page" : ""}`}>
      {isDraggingFile && (
        <div className="kb-drop-overlay">
          <div className="kb-drop-overlay-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{t("dragDropHint")}</span>
          </div>
        </div>
      )}
      <div className="kb-page-header">
        <button className="kb-back-btn" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {t("close")}
        </button>
        <h1>{t("knowledgeBase")}</h1>
        {!loading && totalItems > 0 && (
          <span className="kb-doc-count">{totalItems}</span>
        )}
      </div>
      <div className="kb-breadcrumbs">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={crumb.id || "root"}>
            {i > 0 && <span className="kb-breadcrumb-sep">/</span>}
            <button
              className={`kb-breadcrumb ${i === breadcrumbs.length - 1 ? "active" : ""}`}
              onClick={() => navigateToFolder(crumb.id, i)}
            >
              {i === 0 ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
              ) : null}
              {crumb.name}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div className="kb-page-toolbar">
        <div className="kb-toolbar-left">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleUpload}
            multiple
            accept=".txt,.md,.pdf,.doc,.docx,.png,.jpg,.jpeg,.bmp,.tiff,.tif,.webp"
            style={{ display: "none" }}
          />
          <button
            className="kb-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {uploading ? t("loading") : t("uploadFile")}
          </button>
          <button className="kb-new-folder-btn" onClick={() => setCreateFolderOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
            {t("createFolder")}
          </button>
        </div>
        <div className="kb-toolbar-right">
          <div className="kb-sort-group">
            <button
              className={`kb-sort-btn ${sortOrder === "newest" ? "active" : ""}`}
              onClick={() => setSortOrder("newest")}
            >
              {"↓ " + t("sortNewest")}
            </button>
            <button
              className={`kb-sort-btn ${sortOrder === "oldest" ? "active" : ""}`}
              onClick={() => setSortOrder("oldest")}
            >
              {"↑ " + t("sortOldest")}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="kb-error">{error}</div>}

      <div className="kb-page-body">
        {loading ? (
          <div className="kb-loading">
            <div className="kb-loading-spinner"></div>
            <span>{t("loading")}</span>
          </div>
        ) : totalItems === 0 ? (
          <div className="kb-empty">
            <div className="kb-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
            </div>
            <p>{t("noDocuments")}</p>
            <span>{t("uploadFile")}</span>
          </div>
        ) : (
          <div className="kb-grid">
            {folders.map((folder) => (
              <div
                key={`folder-${folder.id}`}
                className={`kb-folder-card${dragOverFolderId === folder.id ? " drag-over" : ""}`}
                onDoubleClick={() => openFolder(folder)}
                onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                onDragLeave={handleFolderDragLeave}
                onDrop={(e) => handleFolderDrop(e, folder.id)}
              >
                <div className="kb-folder-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                  </svg>
                </div>
                <div className="kb-doc-info">
                  <span className="kb-doc-name" title={folder.name}>{folder.name}</span>
                  <span className="kb-doc-date">{t("createFolder")}</span>
                </div>
                <div className="kb-doc-actions">
                  <button title={t("open")} onClick={() => openFolder(folder)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    title={t("rename")}
                    onClick={() => {
                      setRenamingFolder(folder);
                      setRenameValue(folder.name);
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button title={t("delete")} className="delete" onClick={() => handleDeleteFolder(folder.id)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
            {[...documents]
              .sort((a, b) => {
                const dateA = new Date(a.created_at);
                const dateB = new Date(b.created_at);
                return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
              })
              .map((doc) => (
                <div
                  key={doc.id}
                  className="kb-doc-card"
                  onDoubleClick={() => handleOpenDocument(doc)}
                  draggable="true"
                  onDragStart={(e) => handleDocDragStart(e, doc.id)}
                >
                  {doc.doc_type_label && (
                    <span className="kb-doc-type-badge" style={{
                      background: doc.doc_type === "contract" ? "rgba(139,92,246,0.2)" :
                                  doc.doc_type === "invoice" ? "rgba(59,130,246,0.2)" :
                                  doc.doc_type === "act" ? "rgba(34,197,94,0.2)" :
                                  doc.doc_type === "report" ? "rgba(6,182,212,0.2)" :
                                  "rgba(148,163,184,0.2)",
                      color: doc.doc_type === "contract" ? "#a78bfa" :
                             doc.doc_type === "invoice" ? "#60a5fa" :
                             doc.doc_type === "act" ? "#4ade80" :
                             doc.doc_type === "report" ? "#22d3ee" :
                             "#94a3b8",
                    }}>
                      {doc.doc_type_label}
                    </span>
                  )}
                  <div className="kb-doc-icon">{getFileIcon(doc.filename)}</div>
                  <div className="kb-doc-info">
                    <span className="kb-doc-name" title={doc.filename}>{doc.filename}</span>
                    <span className="kb-doc-date">
                      {new Date(doc.created_at).toLocaleDateString(undefined, {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="kb-doc-actions">
                    <button title={t("open")} onClick={() => handleOpenDocument(doc)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                    <button title={t("copy")} onClick={() => handleCopyDocument(doc)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                      </svg>
                    </button>
                    <button title={t("delete")} className="delete" onClick={() => handleDeleteDocument(doc.id)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
      {createFolderOpen && (
        <div className="kb-viewer-overlay" onClick={() => setCreateFolderOpen(false)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("createFolder")}</h3>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t("folderName")}
              className="kb-modal-input"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
            />
            <div className="kb-modal-buttons">
              <button className="kb-modal-cancel" onClick={() => setCreateFolderOpen(false)}>{t("cancel")}</button>
              <button className="kb-modal-submit" onClick={handleCreateFolder}>{t("add")}</button>
            </div>
          </div>
        </div>
      )}
      {renamingFolder && (
        <div className="kb-viewer-overlay" onClick={() => setRenamingFolder(null)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("rename")}</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t("folderName")}
              className="kb-modal-input"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleRenameFolder()}
            />
            <div className="kb-modal-buttons">
              <button className="kb-modal-cancel" onClick={() => setRenamingFolder(null)}>{t("cancel")}</button>
              <button className="kb-modal-submit" onClick={handleRenameFolder}>{t("save")}</button>
            </div>
          </div>
        </div>
      )}
      {viewerOpen && selectedDoc && (
        <div className="kb-viewer-overlay" onClick={() => setViewerOpen(false)}>
          <div className="kb-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="kb-viewer-header">
              <h4>{selectedDoc.filename}</h4>
              <div className="kb-viewer-actions">
                {!editMode ? (
                  <button onClick={() => setEditMode(true)} title={t("rename")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                ) : (
                  <button onClick={handleSaveDocument} title={t("save")} className="save">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
                  </button>
                )}
                <button onClick={() => setViewerOpen(false)} title={t("close")}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="kb-viewer-body">
              {editMode ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="kb-viewer-editor"
                />
              ) : (
                <div className="kb-viewer-content">
                  {selectedDoc.content || t("noDocuments")}
                </div>
              )}
            </div>
            {docAnalytics && (
              <div className="kb-analytics-section">
                <div className="kb-analytics-row">
                  <span className="kb-analytics-label">Тип:</span>
                  <span className="kb-analytics-badge">{docAnalytics.classification?.type_label || "Не определён"}</span>
                </div>
                {docAnalytics.summary && (
                  <div className="kb-analytics-row">
                    <span className="kb-analytics-label">Резюме:</span>
                    <span className="kb-analytics-text">{docAnalytics.summary}</span>
                  </div>
                )}
                {docAnalytics.entities && (
                  <>
                    {docAnalytics.entities.organizations?.length > 0 && (
                      <div className="kb-analytics-row">
                        <span className="kb-analytics-label">Организации:</span>
                        <div className="kb-analytics-tags">
                          {docAnalytics.entities.organizations.map((org, i) => (
                            <span key={i} className="kb-entity-tag org">{org}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {docAnalytics.entities.dates?.length > 0 && (
                      <div className="kb-analytics-row">
                        <span className="kb-analytics-label">Даты:</span>
                        <div className="kb-analytics-tags">
                          {docAnalytics.entities.dates.slice(0, 5).map((d, i) => (
                            <span key={i} className="kb-entity-tag date">{d}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {docAnalytics.entities.amounts?.length > 0 && (
                      <div className="kb-analytics-row">
                        <span className="kb-analytics-label">Суммы:</span>
                        <div className="kb-analytics-tags">
                          {docAnalytics.entities.amounts.slice(0, 5).map((a, i) => (
                            <span key={i} className="kb-entity-tag amount">{a}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {docAnalytics.entities.emails?.length > 0 && (
                      <div className="kb-analytics-row">
                        <span className="kb-analytics-label">Email:</span>
                        <span className="kb-analytics-text">{docAnalytics.entities.emails.join(", ")}</span>
                      </div>
                    )}
                    {docAnalytics.entities.phones?.length > 0 && (
                      <div className="kb-analytics-row">
                        <span className="kb-analytics-label">Телефоны:</span>
                        <span className="kb-analytics-text">{docAnalytics.entities.phones.join(", ")}</span>
                      </div>
                    )}
                  </>
                )}
                {docAnalytics.stats && (
                  <div className="kb-analytics-row">
                    <span className="kb-analytics-label">Статистика:</span>
                    <span className="kb-analytics-text">
                      {docAnalytics.stats.word_count} слов, {docAnalytics.stats.paragraph_count} абзацев
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="kb-viewer-footer">
              <span>{t("date") + ": " + new Date(selectedDoc.created_at).toLocaleString()}</span>
              {selectedDoc.uploaded_by && <span>{t("author") + ": " + selectedDoc.uploaded_by}</span>}
              <button
                className="kb-analyze-btn"
                onClick={() => handleAnalyzeDocument(selectedDoc)}
                disabled={analyzing}
              >
                {analyzing ? "Анализ..." : "AI-анализ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
