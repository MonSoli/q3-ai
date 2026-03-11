import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LangContext";
import { checkEmail } from "../utils/authApi";
import "./AuthPage.css";

export default function AuthPage() {
  const { login, register } = useAuth();
  const { t } = useLang();
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [regStep, setRegStep] = useState(1);
  const [emailStatus, setEmailStatus] = useState(null);

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setError("");
    setRegStep(1);
    setEmailStatus(null);
  };

  const handleCheckEmail = async () => {
    if (!email.trim()) {
      setError(t("enterEmail"));
      return;
    }
    setError("");
    setLoading(true);

    try {
      const result = await checkEmail(email.trim());
      setEmailStatus(result.status);

      if (result.status === "not_found") {
        setError(t("emailNotFound"));
      } else if (result.status === "already_registered") {
        setError(t("emailAlreadyRegistered"));
      } else if (result.status === "available") {
        setRegStep(2);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (tab === "login") {
      if (!email.trim() || !password.trim()) return;
      setError("");
      setLoading(true);

      try {
        await login(email.trim(), password);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    } else {
      if (regStep === 1) {
        await handleCheckEmail();
      } else {
        if (!password.trim()) {
          setError(t("enterPassword"));
          return;
        }
        if (password !== confirmPassword) {
          setError(t("passwordsNoMatch"));
          return;
        }
        if (password.length < 8) {
          setError(t("passwordTooShort"));
          return;
        }
        if (!/[A-Za-zА-Яа-яЁё]/.test(password)) {
          setError(t("passwordNeedLetter"));
          return;
        }
        if (!/\d/.test(password)) {
          setError(t("passwordNeedDigit"));
          return;
        }

        setError("");
        setLoading(true);

        try {
          await register(email.trim(), password);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      }
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1>{t("authTitle")}</h1>
          <p>{t("authSubtitle")}</p>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === "login" ? "active" : ""}`}
            onClick={() => { setTab("login"); resetForm(); }}
          >
            {t("login")}
          </button>
          <button
            className={`auth-tab ${tab === "register" ? "active" : ""}`}
            onClick={() => { setTab("register"); resetForm(); }}
          >
            {t("register")}
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>{t("email")}</label>
            <input
              type="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={tab === "register" && regStep === 2}
              autoFocus
            />
          </div>

          {tab === "login" && (
            <div className="auth-field">
              <label>{t("password")}</label>
              <input
                type="password"
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {tab === "register" && regStep === 2 && (
            <>
              <div className="auth-field">
                <label>{t("password")}</label>
                <input
                  type="password"
                  placeholder={t("passwordHint")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="auth-field">
                <label>{t("confirmPassword")}</label>
                <input
                  type="password"
                  placeholder={t("confirmPasswordPlaceholder")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </>
          )}

          {error && <div className="auth-error">{error}</div>}

          {tab === "register" && regStep === 2 && (
            <button
              type="button"
              className="auth-back"
              onClick={() => { setRegStep(1); setPassword(""); setConfirmPassword(""); setError(""); }}
            >
              {t("changeEmail")}
            </button>
          )}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading
              ? t("loading")
              : tab === "login"
                ? t("loginBtn")
                : regStep === 1
                  ? t("checkEmail")
                  : t("registerBtn")}
          </button>
        </form>

        {tab === "register" && regStep === 1 && (
          <div className="auth-hint">
            {t("authHint")}
          </div>
        )}
      </div>
    </div>
  );
}
