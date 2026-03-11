import React, { useState, useCallback } from "react";
import { ragSearch } from "../utils/api";
import "./SmartSearch.css";

export default function SmartSearch({ isOpen, onClose, onSelectDocument }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchType, setSearchType] = useState("hybrid");
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const data = await ragSearch(query, 10, searchType);
      setResults(data.results || []);
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
    }
    setSearching(false);
  }, [query, searchType]);

  if (!isOpen) return null;

  const getScoreColor = (score) => {
    if (score >= 0.7) return "#22c55e";
    if (score >= 0.4) return "#f59e0b";
    return "#94a3b8";
  };

  const getMatchBadge = (type) => {
    switch (type) {
      case "hybrid": return { label: "Гибрид", color: "#8b5cf6" };
      case "semantic": return { label: "Семантика", color: "#3b82f6" };
      case "keyword": return { label: "Ключевые слова", color: "#22c55e" };
      default: return { label: type, color: "#94a3b8" };
    }
  };

  return (
    <div className="smart-search-overlay" onClick={onClose}>
      <div className="smart-search-panel" onClick={(e) => e.stopPropagation()}>
        <div className="smart-search-header">
          <div className="smart-search-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
              <path d="M8 8l6 6" opacity="0.5" />
            </svg>
            <h3>Умный поиск (RAG)</h3>
          </div>
          <button className="smart-search-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="smart-search-controls">
          <div className="smart-search-input-row">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по смыслу: например, 'штрафы за нарушение сроков'..."
              className="smart-search-input"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button className="smart-search-btn" onClick={handleSearch} disabled={searching}>
              {searching ? (
                <div className="smart-search-spinner" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              )}
            </button>
          </div>

          <div className="smart-search-type-selector">
            {[
              { key: "hybrid", label: "Гибридный" },
              { key: "semantic", label: "Семантический" },
            ].map((t) => (
              <button
                key={t.key}
                className={`search-type-btn ${searchType === t.key ? "active" : ""}`}
                onClick={() => setSearchType(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="smart-search-results">
          {searching && (
            <div className="smart-search-loading">
              <div className="smart-search-spinner large" />
              <span>Ищем по смыслу...</span>
            </div>
          )}

          {!searching && hasSearched && results.length === 0 && (
            <div className="smart-search-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <p>Ничего не найдено</p>
              <span>Попробуйте переформулировать запрос</span>
            </div>
          )}

          {!searching && results.map((r, i) => {
            const matchBadge = getMatchBadge(r.match_type);
            return (
              <div
                key={r.chunk_id || i}
                className="smart-search-result"
                onClick={() => onSelectDocument?.(r.document_id)}
              >
                <div className="result-header">
                  <span className="result-filename">{r.filename}</span>
                  <div className="result-badges">
                    <span
                      className="result-match-badge"
                      style={{ background: matchBadge.color + "20", color: matchBadge.color }}
                    >
                      {matchBadge.label}
                    </span>
                    <span
                      className="result-score"
                      style={{ color: getScoreColor(r.score) }}
                    >
                      {Math.round(r.score * 100)}%
                    </span>
                  </div>
                </div>
                <div className="result-content">{r.content}</div>
              </div>
            );
          })}
        </div>

        {!hasSearched && (
          <div className="smart-search-hint">
            <p>Семантический поиск находит документы <strong>по смыслу</strong>, а не по точному совпадению слов.</p>
            <p>Пример: запрос "ответственность за задержку" найдёт пункты о штрафах и неустойках.</p>
          </div>
        )}
      </div>
    </div>
  );
}
