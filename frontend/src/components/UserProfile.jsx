import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LangContext";
import { changePassword } from "../utils/authApi";
import "./UserProfile.css";

export default function UserProfile({ isOpen, onClose }) {
  const { user, token } = useAuth();
  const { t } = useLang();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!currentPassword.trim()) {
      setError(t("enterCurrentPassword"));
      return;
    }
    if (!newPassword.trim()) {
      setError(t("enterNewPassword"));
      return;
    }
    if (newPassword.length < 4) {
      setError(t("passwordTooShortProfile"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("passwordsNoMatch"));
      return;
    }

    setLoading(true);
    try {
      await changePassword(token, currentPassword, newPassword);
      setMessage(t("passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !user) return null;

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-panel" onClick={(e) => e.stopPropagation()}>
        <div className="profile-header">
          <h3>{t("profileTitle")}</h3>
          <button className="profile-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="profile-body">
          {/* User Info Section */}
          <div className="profile-section">
            <h4>{t("personalData")}</h4>
            <div className="profile-info">
              <div className="profile-field">
                <span className="profile-label">{t("lastName")}</span>
                <span className="profile-value">{user.last_name || "\u2014"}</span>
              </div>
              <div className="profile-field">
                <span className="profile-label">{t("firstName")}</span>
                <span className="profile-value">{user.first_name || "\u2014"}</span>
              </div>
              <div className="profile-field">
                <span className="profile-label">{t("patronymic")}</span>
                <span className="profile-value">{user.patronymic || "\u2014"}</span>
              </div>
              <div className="profile-field">
                <span className="profile-label">{t("position")}</span>
                <span className="profile-value">{user.position || "\u2014"}</span>
              </div>
              <div className="profile-field">
                <span className="profile-label">{t("email")}</span>
                <span className="profile-value">{user.email}</span>
              </div>
            </div>
            <div className="profile-note">
              {t("personalDataNote")}
            </div>
          </div>

          {/* Password Change Section */}
          <div className="profile-section">
            <h4>{t("changePassword")}</h4>
            <form onSubmit={handleChangePassword}>
              <div className="password-field">
                <label>{t("currentPassword")}</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t("enterCurrentPassword")}
                />
              </div>
              <div className="password-field">
                <label>{t("newPassword")}</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("enterNewPassword")}
                />
              </div>
              <div className="password-field">
                <label>{t("confirmNewPassword")}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("repeatNewPassword")}
                />
              </div>

              {error && <div className="profile-error">{error}</div>}
              {message && <div className="profile-success">{message}</div>}

              <button type="submit" className="profile-submit" disabled={loading}>
                {loading ? t("saving") : t("changePassword")}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
