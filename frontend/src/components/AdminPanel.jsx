import React, { useState, useEffect, useCallback } from "react";
import { fetchUsers, createUser, updateUser, deleteUser, fetchBackups, createBackup, restoreBackup, deleteBackup } from "../utils/api";
import { useLang } from "../contexts/LangContext";
import "./AdminPanel.css";

export default function AdminPanel({ isOpen, onClose }) {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    email: "",
    first_name: "",
    last_name: "",
    patronymic: "",
    position: "",
  });
  const [formError, setFormError] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [backups, setBackups] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsError, setBackupsError] = useState("");
  const [backupNote, setBackupNote] = useState("");
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringId, setRestoringId] = useState(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBackups = useCallback(async () => {
    setBackupsLoading(true);
    setBackupsError("");
    try {
      const data = await fetchBackups();
      setBackups(data);
    } catch (err) {
      setBackupsError(err.message);
    } finally {
      setBackupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadUsers();
      loadBackups();
    }
  }, [isOpen, loadUsers, loadBackups]);

  const resetForm = () => {
    setFormData({
      email: "",
      first_name: "",
      last_name: "",
      patronymic: "",
      position: "",
    });
    setFormError("");
    setEditingUser(null);
    setShowForm(false);
  };

  const handleAddClick = () => {
    resetForm();
    setShowForm(true);
  };

  const handleEditClick = (user) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      patronymic: user.patronymic || "",
      position: user.position || "",
    });
    setFormError("");
    setShowForm(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!formData.email.trim() || !formData.first_name.trim() || !formData.last_name.trim()) {
      setFormError(t("emailFirstLastRequired"));
      return;
    }

    setFormLoading(true);
    setFormError("");

    try {
      if (editingUser) {
        await updateUser(editingUser.id, formData);
      } else {
        await createUser(formData);
      }
      await loadUsers();
      resetForm();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteClick = (user) => {
    setDeleteConfirm(user);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;

    try {
      await deleteUser(deleteConfirm.id);
      await loadUsers();
      setDeleteConfirm(null);
    } catch (err) {
      setError(err.message);
      setDeleteConfirm(null);
    }
  };

  const handleToggleActive = async (user) => {
    try {
      await updateUser(user.id, { is_active: !user.is_active });
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const getStatusBadge = (user) => {
    if (user.is_admin) return <span className="status-badge admin">{t("admin")}</span>;
    if (!user.is_registered) return <span className="status-badge pending">{t("pending")}</span>;
    if (!user.is_active) return <span className="status-badge inactive">{t("inactive")}</span>;
    return <span className="status-badge active">{t("active")}</span>;
  };

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    setBackupsError("");
    try {
      await createBackup(backupNote.trim());
      setBackupNote("");
      await loadBackups();
    } catch (err) {
      setBackupsError(err.message);
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (backupId) => {
    if (!window.confirm(t("restoreConfirm"))) return;
    setRestoringId(backupId);
    setBackupsError("");
    try {
      await restoreBackup(backupId);
      setBackupsError("");
      window.location.reload();
    } catch (err) {
      setBackupsError(err.message);
    } finally {
      setRestoringId(null);
    }
  };

  const handleDeleteBackup = async (backupId) => {
    if (!window.confirm(t("deleteBackupConfirm"))) return;
    try {
      await deleteBackup(backupId);
      await loadBackups();
    } catch (err) {
      setBackupsError(err.message);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "0 Б";
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  };

  if (!isOpen) return null;

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-panel" onClick={(e) => e.stopPropagation()}>
        <div className="admin-header">
          <h3>{t("adminTitle")}</h3>
          <button className="admin-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="admin-tabs">
          <button
            className={`admin-tab ${activeTab === "users" ? "active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
            {t("users")}
          </button>
          <button
            className={`admin-tab ${activeTab === "backups" ? "active" : ""}`}
            onClick={() => setActiveTab("backups")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t("backups")}
          </button>
        </div>

        <div className="admin-body">
          {activeTab === "users" && (
            <>
              {error && <div className="admin-error">{error}</div>}

              <div className="admin-toolbar">
                <button className="admin-btn-add" onClick={handleAddClick}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  {t("addUser")}
                </button>
              </div>

              {loading ? (
                <div className="admin-loading">{t("loading")}</div>
              ) : (
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t("fio")}</th>
                        <th>{t("position")}</th>
                        <th>{t("email")}</th>
                        <th>{t("status")}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td>
                            {user.last_name} {user.first_name} {user.patronymic}
                          </td>
                          <td>{user.position || "\u2014"}</td>
                          <td>{user.email}</td>
                          <td>{getStatusBadge(user)}</td>
                          <td className="admin-actions">
                            {!user.is_admin && (
                              <>
                                <button
                                  className="action-btn edit"
                                  onClick={() => handleEditClick(user)}
                                  title={t("edit")}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                  </svg>
                                </button>
                                {user.is_registered && (
                                  <button
                                    className={`action-btn ${user.is_active ? "deactivate" : "activate"}`}
                                    onClick={() => handleToggleActive(user)}
                                    title={user.is_active ? t("deactivate") : t("activate")}
                                  >
                                    {user.is_active ? (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M4.93 4.93l14.14 14.14" />
                                      </svg>
                                    ) : (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                        <polyline points="22 4 12 14.01 9 11.01" />
                                      </svg>
                                    )}
                                  </button>
                                )}
                                <button
                                  className="action-btn delete"
                                  onClick={() => handleDeleteClick(user)}
                                  title={t("delete")}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                      {users.length === 0 && (
                        <tr>
                          <td colSpan="5" className="admin-empty">
                            {t("noUsers")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === "backups" && (
            <>
              {backupsError && <div className="admin-error">{backupsError}</div>}

              <div className="admin-toolbar backup-toolbar">
                <div className="backup-create-row">
                  <input
                    type="text"
                    className="backup-note-input"
                    value={backupNote}
                    onChange={(e) => setBackupNote(e.target.value)}
                    placeholder={t("backupNotePlaceholder")}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateBackup()}
                  />
                  <button
                    className="admin-btn-add"
                    onClick={handleCreateBackup}
                    disabled={creatingBackup}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
                    {creatingBackup ? t("creating") : t("createBackup")}
                  </button>
                </div>
              </div>

              {backupsLoading ? (
                <div className="admin-loading">{t("loading")}</div>
              ) : (
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t("date")}</th>
                        <th>{t("size")}</th>
                        <th>{t("note")}</th>
                        <th>{t("author")}</th>
                        <th>{t("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backups.map((backup) => (
                        <tr key={backup.id}>
                          <td>
                            {new Date(backup.created_at).toLocaleString("ru-RU", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td>{formatFileSize(backup.file_size)}</td>
                          <td>{backup.note || "\u2014"}</td>
                          <td>{backup.created_by || "\u2014"}</td>
                          <td className="admin-actions">
                            <button
                              className="action-btn activate"
                              onClick={() => handleRestoreBackup(backup.id)}
                              title={t("restore")}
                              disabled={restoringId === backup.id}
                            >
                              {restoringId === backup.id ? (
                                <span className="btn-spinner" />
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="1 4 1 10 7 10" />
                                  <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                                </svg>
                              )}
                            </button>
                            <button
                              className="action-btn delete"
                              onClick={() => handleDeleteBackup(backup.id)}
                              title={t("delete")}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                      {backups.length === 0 && (
                        <tr>
                          <td colSpan="5" className="admin-empty">
                            {t("noBackups")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {showForm && (
          <div className="admin-modal-overlay" onClick={resetForm}>
            <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
              <h4>{editingUser ? t("editUser") : t("addUser")}</h4>
              <form onSubmit={handleFormSubmit}>
                <div className="form-field">
                  <label>{t("lastName") + " *"}</label>
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    placeholder="Иванов"
                  />
                </div>
                <div className="form-field">
                  <label>{t("firstName") + " *"}</label>
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    placeholder="Иван"
                  />
                </div>
                <div className="form-field">
                  <label>{t("patronymic")}</label>
                  <input
                    type="text"
                    value={formData.patronymic}
                    onChange={(e) => setFormData({ ...formData, patronymic: e.target.value })}
                    placeholder="Иванович"
                  />
                </div>
                <div className="form-field">
                  <label>{t("position")}</label>
                  <input
                    type="text"
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    placeholder="Менеджер"
                  />
                </div>
                <div className="form-field">
                  <label>{t("email") + " *"}</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="ivan@company.ru"
                    disabled={editingUser && editingUser.is_registered}
                  />
                </div>

                {formError && <div className="form-error">{formError}</div>}

                <div className="form-buttons">
                  <button type="button" className="btn-cancel" onClick={resetForm}>
                    {t("cancel")}
                  </button>
                  <button type="submit" className="btn-submit" disabled={formLoading}>
                    {formLoading ? t("saving") : editingUser ? t("save") : t("add")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {deleteConfirm && (
          <div className="admin-modal-overlay" onClick={() => setDeleteConfirm(null)}>
            <div className="admin-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
              <h4>{t("deleteUser")}</h4>
              <p>
                {t("deleteUserConfirmMsg")}{" "}
                <strong>{deleteConfirm.last_name} {deleteConfirm.first_name}</strong>?
              </p>
              <p className="warning">{t("deleteUserConfirm")}</p>
              <div className="form-buttons">
                <button className="btn-cancel" onClick={() => setDeleteConfirm(null)}>
                  {t("cancel")}
                </button>
                <button className="btn-delete" onClick={handleDeleteConfirm}>
                  {t("delete")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
