import React from "react";
import { useLang } from "../contexts/LangContext";
import "./Settings.css";

export default function Settings({
  isOpen,
  onClose,
  theme,
  onThemeToggle,
}) {
  const { t, lang, changeLang } = useLang();

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>{t("settingsTitle")}</h3>
          <button className="settings-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="settings-body">
          {/* Language selector */}
          <div className="setting-group">
            <label className="setting-label">{t("language")}</label>
            <div className="setting-toggle-row">
              <button
                className={`ctx-preset-btn ${lang === "ru" ? "active" : ""}`}
                onClick={() => changeLang("ru")}
                style={{ flex: 1 }}
              >
                Русский
              </button>
              <button
                className={`ctx-preset-btn ${lang === "en" ? "active" : ""}`}
                onClick={() => changeLang("en")}
                style={{ flex: 1 }}
              >
                English
              </button>
            </div>
          </div>

          {/* Theme toggle */}
          <div className="setting-group">
            <label className="setting-label">{t("theme")}</label>
            <div className="setting-toggle-row">
              <button
                className={`toggle-btn ${theme === "dark" ? "active" : ""}`}
                onClick={onThemeToggle}
              >
                <span className="toggle-knob" />
              </button>
              <span className="toggle-label">
                {theme === "dark" ? (
                  <span className="theme-label-content">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                    </svg>
                    {t("themeDark")}
                  </span>
                ) : (
                  <span className="theme-label-content">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="5" />
                      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                    </svg>
                    {t("themeLight")}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Keyboard shortcuts info */}
          <div className="setting-group">
            <label className="setting-label">{t("hotkeys")}</label>
            <div className="shortcuts-list">
              <div className="shortcut-item">
                <span className="shortcut-keys"><kbd>Alt</kbd>+<kbd>N</kbd></span>
                <span className="shortcut-desc">{t("hotkeyNewChat")}</span>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>F</kbd></span>
                <span className="shortcut-desc">{t("hotkeySearch")}</span>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-keys"><kbd>Enter</kbd></span>
                <span className="shortcut-desc">{t("hotkeySend")}</span>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-keys"><kbd>Shift</kbd>+<kbd>Enter</kbd></span>
                <span className="shortcut-desc">{t("hotkeyNewLine")}</span>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-keys"><kbd>Esc</kbd></span>
                <span className="shortcut-desc">{t("hotkeyClose")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
