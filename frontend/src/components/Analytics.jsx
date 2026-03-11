import React, { useState, useEffect, useCallback } from "react";
import {
  getAnalyticsDashboard,
  getDocumentTimeline,
  getKnowledgeGraph,
  ragStatus,
  ragReindex,
} from "../utils/api";
import "./Analytics.css";

export default function Analytics({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [dashboard, setDashboard] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [ragInfo, setRagInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, rag] = await Promise.all([
        getAnalyticsDashboard(),
        ragStatus(),
      ]);
      setDashboard(dash);
      setRagInfo(rag);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  useEffect(() => {
    if (isOpen && activeTab === "timeline" && timeline.length === 0) {
      getDocumentTimeline().then((d) => setTimeline(d.timeline || []));
    }
    if (isOpen && activeTab === "graph" && graph.nodes.length === 0) {
      getKnowledgeGraph().then((d) => setGraph(d));
    }
  }, [isOpen, activeTab, timeline.length, graph.nodes.length]);

  const handleReindex = async () => {
    setReindexing(true);
    try {
      await ragReindex();
      await loadData();
    } catch (err) {
      console.error("Reindex failed:", err);
    }
    setReindexing(false);
  };

  if (!isOpen) return null;

  const typeColors = {
    contract: "#8b5cf6",
    invoice: "#3b82f6",
    act: "#22c55e",
    order: "#f59e0b",
    letter: "#ec4899",
    report: "#06b6d4",
    protocol: "#f97316",
    other: "#94a3b8",
  };

  return (
    <div className="analytics-overlay" onClick={onClose}>
      <div className="analytics-panel" onClick={(e) => e.stopPropagation()}>
        <div className="analytics-header">
          <h3>Аналитика документов</h3>
          <button className="analytics-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="analytics-tabs">
          {[
            { key: "overview", label: "Обзор" },
            { key: "timeline", label: "Хронология" },
            { key: "graph", label: "Граф связей" },
            { key: "rag", label: "RAG / Индексация" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`analytics-tab ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="analytics-body">
          {loading && activeTab === "overview" ? (
            <div className="analytics-loading">
              <div className="analytics-spinner" />
              <span>Загрузка аналитики...</span>
            </div>
          ) : (
            <>
              {/* === OVERVIEW TAB === */}
              {activeTab === "overview" && dashboard && (
                <div className="analytics-overview">
                  <div className="analytics-stats-grid">
                    <div className="stat-card">
                      <div className="stat-value">{dashboard.total_documents}</div>
                      <div className="stat-label">Документов</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{dashboard.total_chunks}</div>
                      <div className="stat-label">Чанков (RAG)</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{dashboard.top_tags?.length || 0}</div>
                      <div className="stat-label">Тегов</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{dashboard.top_organizations?.length || 0}</div>
                      <div className="stat-label">Организаций</div>
                    </div>
                  </div>

                  {/* Document types chart */}
                  {dashboard.by_type?.length > 0 && (
                    <div className="analytics-section">
                      <h4>Типы документов</h4>
                      <div className="type-chart">
                        {dashboard.by_type.map((t, i) => {
                          const maxCnt = Math.max(...dashboard.by_type.map((x) => x.cnt));
                          const pct = maxCnt > 0 ? (t.cnt / maxCnt) * 100 : 0;
                          const color = typeColors[t.doc_type] || "#94a3b8";
                          return (
                            <div key={i} className="type-bar-row">
                              <span className="type-label">{t.doc_type_label || t.doc_type}</span>
                              <div className="type-bar-container">
                                <div
                                  className="type-bar"
                                  style={{ width: `${pct}%`, background: color }}
                                />
                              </div>
                              <span className="type-count">{t.cnt}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Top organizations */}
                  {dashboard.top_organizations?.length > 0 && (
                    <div className="analytics-section">
                      <h4>Упоминаемые организации</h4>
                      <div className="org-list">
                        {dashboard.top_organizations.map((org, i) => (
                          <div key={i} className="org-item">
                            <span className="org-name">{org.name}</span>
                            <span className="org-count">{org.count} док.</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Top tags */}
                  {dashboard.top_tags?.length > 0 && (
                    <div className="analytics-section">
                      <h4>Теги</h4>
                      <div className="tags-cloud">
                        {dashboard.top_tags.map((tag, i) => (
                          <span key={i} className="analytics-tag">
                            {tag.tag}
                            <span className="tag-count">{tag.cnt}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* === TIMELINE TAB === */}
              {activeTab === "timeline" && (
                <div className="analytics-timeline">
                  {timeline.length === 0 ? (
                    <div className="analytics-empty">Нет данных для хронологии</div>
                  ) : (
                    <div className="timeline-list">
                      {timeline.map((doc, i) => {
                        const color = typeColors[doc.doc_type] || "#94a3b8";
                        return (
                          <div key={doc.id || i} className="timeline-item">
                            <div className="timeline-dot" style={{ background: color }} />
                            <div className="timeline-content">
                              <div className="timeline-filename">{doc.filename}</div>
                              <div className="timeline-meta">
                                {doc.doc_type_label && (
                                  <span className="timeline-type" style={{ color }}>
                                    {doc.doc_type_label}
                                  </span>
                                )}
                                <span className="timeline-date">
                                  {new Date(doc.created_at).toLocaleDateString("ru-RU", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {doc.uploaded_by && (
                                  <span className="timeline-author">{doc.uploaded_by}</span>
                                )}
                              </div>
                            </div>
                            <div className="timeline-size">
                              {doc.file_size ? `${(doc.file_size / 1024).toFixed(1)} КБ` : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* === GRAPH TAB === */}
              {activeTab === "graph" && (
                <div className="analytics-graph">
                  {graph.nodes.length === 0 ? (
                    <div className="analytics-empty">
                      <p>Граф связей пока пуст.</p>
                      <p>Загрузите документы и запустите анализ, чтобы увидеть связи.</p>
                    </div>
                  ) : (
                    <div className="graph-visual">
                      <div className="graph-stats">
                        <span>{graph.nodes.filter((n) => n.group === "document").length} документов</span>
                        <span>{graph.nodes.filter((n) => n.group === "entity").length} сущностей</span>
                        <span>{graph.edges.length} связей</span>
                      </div>
                      <div className="graph-nodes-list">
                        {graph.nodes
                          .filter((n) => n.group === "entity")
                          .map((node, i) => {
                            const connectedDocs = graph.edges
                              .filter((e) => e.target === node.id || e.source === node.id)
                              .map((e) => {
                                const otherId = e.source === node.id ? e.target : e.source;
                                return graph.nodes.find((n) => n.id === otherId);
                              })
                              .filter(Boolean);
                            return (
                              <div key={node.id || i} className="graph-entity-card">
                                <div className="graph-entity-name">{node.label}</div>
                                <div className="graph-entity-docs">
                                  {connectedDocs.map((doc, j) => (
                                    <span key={j} className="graph-doc-badge">{doc.label}</span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* === RAG TAB === */}
              {activeTab === "rag" && (
                <div className="analytics-rag">
                  {ragInfo && (
                    <div className="rag-status-cards">
                      <div className="stat-card">
                        <div className="stat-value">{ragInfo.total_documents}</div>
                        <div className="stat-label">Всего документов</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-value">{ragInfo.indexed_documents}</div>
                        <div className="stat-label">Проиндексировано</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-value">{ragInfo.total_chunks}</div>
                        <div className="stat-label">Чанков</div>
                      </div>
                      <div className="stat-card">
                        <div
                          className="stat-value"
                          style={{
                            color: ragInfo.indexing_complete ? "#22c55e" : "#f59e0b",
                          }}
                        >
                          {ragInfo.indexing_complete ? "Готово" : "Не полная"}
                        </div>
                        <div className="stat-label">Индексация</div>
                      </div>
                    </div>
                  )}

                  <div className="rag-actions">
                    <button
                      className="rag-reindex-btn"
                      onClick={handleReindex}
                      disabled={reindexing}
                    >
                      {reindexing ? (
                        <>
                          <div className="analytics-spinner small" />
                          Переиндексация...
                        </>
                      ) : (
                        <>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M23 4v6h-6M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                          </svg>
                          Переиндексировать все документы
                        </>
                      )}
                    </button>
                  </div>

                  <div className="rag-info">
                    <h4>Как работает RAG?</h4>
                    <ol>
                      <li>Документы разбиваются на небольшие фрагменты (чанки)</li>
                      <li>Для каждого чанка генерируется числовой вектор (эмбеддинг)</li>
                      <li>При вопросе пользователя его запрос тоже преобразуется в вектор</li>
                      <li>Находятся наиболее похожие фрагменты по косинусному сходству</li>
                      <li>Найденный контекст добавляется к промпту для точного ответа</li>
                    </ol>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
