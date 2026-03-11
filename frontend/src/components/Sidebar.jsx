import React, { memo, useCallback, useState } from "react";
import { useLang } from "../contexts/LangContext";
import "./Sidebar.css";

const ChatItem = memo(function ChatItem({ chat, isActive, onSelect, onDelete, onRename, collapsed, t }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(chat.title || "");

  const handleDelete = useCallback((e) => {
    e.stopPropagation();
    onDelete(chat.id);
  }, [chat.id, onDelete]);

  const handleDoubleClick = useCallback((e) => {
    e.stopPropagation();
    if (collapsed) return;
    setEditValue(chat.title || "");
    setEditing(true);
  }, [chat.title, collapsed]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== chat.title) {
      onRename(chat.id, trimmed);
    }
    setEditing(false);
  }, [editValue, chat.id, chat.title, onRename]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") handleRenameSubmit();
    if (e.key === "Escape") setEditing(false);
  }, [handleRenameSubmit]);

  return (
    <div
      className={`chat-item ${isActive ? "active" : ""}`}
      onClick={() => onSelect(chat.id)}
      title={chat.title || t("newChat")}
    >
      <svg className="chat-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
      {!collapsed && (
        <>
          {editing ? (
            <input
              className="chat-title-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className="chat-title" onDoubleClick={handleDoubleClick}>
              {chat.title || t("newChat")}
            </span>
          )}
          <button
            className="delete-btn"
            onClick={handleDelete}
            title={t("delete")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
});

export default memo(function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onOpenSettings,
  onOpenProfile,
  onOpenAdmin,
  onOpenDatabase,
  onOpenSearch,
  onLogout,
  user,
  isOpen,
  isMobile,
  collapsed,
  onToggleCollapse,
}) {
  const { t } = useLang();

  return (
    <div className={`sidebar ${isMobile && isOpen ? "mobile-open" : ""} ${collapsed ? "collapsed" : ""}`}>
      {/* Logo + collapse toggle */}
      <div className="sidebar-logo-row">
        <button
          className={`sidebar-logo ${collapsed ? "collapsed-logo" : ""}`}
          onClick={collapsed ? onToggleCollapse : () => window.location.reload()}
          title={collapsed ? t("expand") : "Q3 AI"}
        >
          <span className="logo-text">Q3</span>
          <svg className="logo-expand-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
        {!isMobile && !collapsed && (
          <button className="sidebar-collapse-btn" onClick={onToggleCollapse} title={t("collapse")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Top menu buttons */}
      <div className="sidebar-header">
        <button className="menu-btn new-chat" onClick={onNewChat} title={t("newChat")}>
          <div className="menu-btn-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {!collapsed && <span>{t("newChat")}</span>}
          </div>
        </button>

        <button className="menu-btn" onClick={onOpenSearch} title={t("searchChats")}>
          <div className="menu-btn-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            {!collapsed && <span>{t("searchChats")}</span>}
          </div>
        </button>

        <button className="menu-btn" onClick={onOpenDatabase} title={t("database")}>
          <div className="menu-btn-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
            {!collapsed && <span>{t("database")}</span>}
          </div>
        </button>
      </div>

      {!collapsed && chats.length > 0 && (
        <div className="sidebar-section-label">{t("chats")}</div>
      )}

      <div className="chat-list">
        {chats.map((chat) => (
          <ChatItem
            key={chat.id}
            chat={chat}
            isActive={chat.id === activeChatId}
            onSelect={onSelectChat}
            onDelete={onDeleteChat}
            onRename={onRenameChat}
            collapsed={collapsed}
            t={t}
          />
        ))}
      </div>

      <div className="sidebar-bottom">
        {!collapsed && user && (
          <div className="sidebar-user-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>{user.last_name} {user.first_name}</span>
          </div>
        )}

        {onOpenProfile && (
          <button className="sidebar-bottom-btn" onClick={onOpenProfile} title={t("profile")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {!collapsed && <span>{t("profile")}</span>}
          </button>
        )}

        {user?.is_admin && onOpenAdmin && (
          <button className="sidebar-bottom-btn admin-btn" onClick={onOpenAdmin} title={t("adminPanel")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            {!collapsed && <span>{t("adminPanel")}</span>}
          </button>
        )}

        <button className="sidebar-bottom-btn" onClick={onOpenSettings} title={t("settings")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
          {!collapsed && <span>{t("settings")}</span>}
        </button>
        {onLogout && (
          <button className="sidebar-bottom-btn logout-btn" onClick={onLogout} title={t("logout")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {!collapsed && <span>{t("logout")}</span>}
          </button>
        )}
      </div>
    </div>
  );
});
