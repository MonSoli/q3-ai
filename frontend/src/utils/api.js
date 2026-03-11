import { API_BASE } from "../config";

function getToken() {
  return localStorage.getItem("qwen3_token");
}

function authHeaders(extra = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function authFetch(url, options = {}) {
  const headers = authHeaders(options.headers);
  let res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    const rt = localStorage.getItem("qwen3_refresh_token");
    if (rt) {
      try {
        const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          localStorage.setItem("qwen3_token", data.token);
          localStorage.setItem("qwen3_refresh_token", data.refresh_token);
          headers["Authorization"] = `Bearer ${data.token}`;
          res = await fetch(url, { ...options, headers });
        }
      } catch {}
    }
  }

  return res;
}

export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();
    return data;
  } catch {
    return { status: "error", ollama: "disconnected" };
  }
}

export async function fetchModels() {
  try {
    const res = await fetch(`${API_BASE}/api/models`);
    const data = await res.json();
    return data.models || [];
  } catch {
    return [];
  }
}

export async function warmupModel(model) {
  try {
    await fetch(`${API_BASE}/api/warmup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
  } catch {}
}

export async function streamChat({ messages, model, temperature, thinking, num_ctx, chatId, onToken, onDone, onToolUse, signal }) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages, model, temperature, thinking, num_ctx, chat_id: chatId }),
    signal,
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let doneEmitted = false;
  const emitDone = () => {
    if (!doneEmitted) {
      doneEmitted = true;
      onDone?.();
    }
  };

  const processLineWrapped = (line) => {
    if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.status === "tool_call") {
          onToolUse?.(data.tool);
        } else if (data.status === "thinking") {
          onToolUse?.(`анализ (шаг ${data.round})...`);
        } else if (data.status === "working") {
          onToolUse?.("обработка...");
        } else if (data.status === "generating") {
          onToolUse?.("генерация ответа...");
        } else if (data.token) {
          onToken(data.token);
        }
        if (data.done) {
          emitDone();
        }
      } catch {}
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        processLineWrapped(buffer.trim());
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      processLineWrapped(line);
    }
  }

  emitDone();
}

export async function fetchChats() {
  const res = await authFetch(`${API_BASE}/api/chats`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.chats || [];
}

export async function createChat(title) {
  const res = await authFetch(`${API_BASE}/api/chats`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create chat");
  return res.json();
}

export async function fetchChat(chatId) {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}`);
  if (!res.ok) throw new Error("Chat not found");
  return res.json();
}

export async function deleteChat(chatId) {
  await authFetch(`${API_BASE}/api/chats/${chatId}`, { method: "DELETE" });
}

export async function renameChat(chatId, title) {
  await authFetch(`${API_BASE}/api/chats/${chatId}`, {
    method: "PUT",
    body: JSON.stringify({ title }),
  });
}

export async function generateChatTitle(chatId, message, model) {
  try {
    const res = await authFetch(`${API_BASE}/api/chats/${chatId}/generate-title`, {
      method: "POST",
      body: JSON.stringify({ message, model }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch {
    return null;
  }
}

export async function saveMessage(chatId, message) {
  const res = await authFetch(`${API_BASE}/api/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error("Failed to save message");
  return res.json();
}

export async function fetchSettings() {
  const res = await authFetch(`${API_BASE}/api/settings`);
  if (!res.ok) return null;
  return res.json();
}

export async function updateSettings(settings) {
  const res = await authFetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return res.json();
}

export async function importChats(chats) {
  const res = await authFetch(`${API_BASE}/api/migrate/import-chats`, {
    method: "POST",
    body: JSON.stringify({ chats }),
  });
  if (!res.ok) throw new Error("Import failed");
  return res.json();
}

export async function fetchUsers() {
  const res = await authFetch(`${API_BASE}/api/admin/users`);
  if (!res.ok) throw new Error("Ошибка загрузки пользователей");
  const data = await res.json();
  return data.users || [];
}

export async function createUser(userData) {
  const res = await authFetch(`${API_BASE}/api/admin/users`, {
    method: "POST",
    body: JSON.stringify(userData),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка создания пользователя");
  }
  return res.json();
}

export async function updateUser(userId, userData) {
  const res = await authFetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(userData),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка обновления пользователя");
  }
  return res.json();
}

export async function deleteUser(userId) {
  const res = await authFetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка удаления пользователя");
  }
  return res.json();
}

export async function fetchKBFolders(parentId = null) {
  const url = parentId
    ? `${API_BASE}/api/knowledge/folders?parent_id=${parentId}`
    : `${API_BASE}/api/knowledge/folders`;
  const res = await authFetch(url);
  if (!res.ok) return [];
  return res.json();
}

export async function createKBFolder(name, parentId = null) {
  const res = await authFetch(`${API_BASE}/api/knowledge/folders`, {
    method: "POST",
    body: JSON.stringify({ name, parent_id: parentId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка создания папки");
  }
  return res.json();
}

export async function renameKBFolder(folderId, name) {
  const res = await authFetch(`${API_BASE}/api/knowledge/folders/${folderId}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка переименования");
  }
  return res.json();
}

export async function deleteKBFolder(folderId) {
  const res = await authFetch(`${API_BASE}/api/knowledge/folders/${folderId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка удаления папки");
  }
  return res.json();
}

export async function moveKBDocument(docId, folderId) {
  const res = await authFetch(`${API_BASE}/api/knowledge/documents/${docId}/move`, {
    method: "POST",
    body: JSON.stringify({ folder_id: folderId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка перемещения");
  }
  return res.json();
}

export async function sortAndUploadFiles(files) {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/knowledge/sort-upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Ошибка сортировки файлов");
  }
  return res.json();
}

export async function exportChatToPdf(chatTitle, messages) {
  const { jsPDF } = await import("jspdf");
  const html2canvas = (await import("html2canvas")).default;
  const { marked } = await import("marked");

  marked.setOptions({ gfm: true, breaks: true });

  const title = chatTitle || "Чат";
  const date = new Date().toLocaleString("ru-RU");

  let body = "";
  for (const msg of messages) {
    const role = msg.role === "user" ? "Вы" : "Ассистент";
    const roleClass = msg.role === "user" ? "role-user" : "role-assistant";
    const raw = (msg.displayContent || msg.content || "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();
    const rawHtml = marked.parse(raw);
    const htmlContent = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/javascript\s*:/gi, "");
    let filesHtml = "";
    if (msg.files && msg.files.length > 0) {
      const fileItems = msg.files
        .map((f) => `<span class="pdf-file-chip">\u{1F4CE} ${f.name}</span>`)
        .join("");
      filesHtml = `<div class="pdf-files">${fileItems}</div>`;
    }
    body += `<div class="msg"><div class="role ${roleClass}">${role}</div>${filesHtml}<div class="content">${htmlContent}</div></div>`;
  }

  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;padding:40px 48px;background:#fff;" +
    "font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.65;color:#1e1e1e;";
  container.innerHTML = `
    <style>
      .pdf-title{font-size:22px;font-weight:700;margin:0 0 4px;}
      .pdf-date{color:#888;font-size:11px;margin-bottom:16px;}
      .pdf-hr{border:none;border-top:1px solid #ddd;margin:16px 0;}
      .msg{margin-bottom:22px;}
      .role{font-weight:700;font-size:13px;margin-bottom:4px;}
      .role-user{color:#6c5ce7;}
      .role-assistant{color:#22c55e;}
      .pdf-files{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px;}
      .pdf-file-chip{display:inline-flex;align-items:center;background:#f0eeff;color:#5b4dc7;font-size:12px;padding:3px 10px;border-radius:6px;border:1px solid #d8d0f8;}
      .content h1,.content h2,.content h3,.content h4{margin:12px 0 6px;color:#1e1e1e;}
      .content h1{font-size:20px;} .content h2{font-size:17px;} .content h3{font-size:15px;} .content h4{font-size:14px;}
      .content p{margin:6px 0;}
      .content ul,.content ol{margin:6px 0;padding-left:24px;}
      .content li{margin:2px 0;}
      .content strong{font-weight:700;}
      .content em{font-style:italic;}
      .content code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px;font-family:Consolas,'Courier New',monospace;}
      .content pre{background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;margin:8px 0;}
      .content pre code{background:none;padding:0;}
      .content blockquote{border-left:3px solid #ddd;margin:8px 0;padding:4px 12px;color:#555;}
      .content hr{border:none;border-top:1px solid #e0e0e0;margin:12px 0;}
      .content table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px;}
      .content th{background:#f5f5f5;font-weight:700;text-align:left;padding:8px 10px;border:1px solid #d0d0d0;}
      .content td{padding:7px 10px;border:1px solid #d0d0d0;}
      .content tr:nth-child(even) td{background:#fafafa;}
    </style>
    <div class="pdf-title">${title.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</div>
    <div class="pdf-date">${date}</div>
    <hr class="pdf-hr">
    ${body}`;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    const pdfWidth = 210;
    const pdfHeight = 297;
    const imgWidth = pdfWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    const pdf = new jsPDF("p", "mm", "a4");
    let position = 0;
    let heightLeft = imgHeight;

    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;

    while (heightLeft > 0) {
      position -= pdfHeight;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
    }

    const filename = `${title.replace(/[^a-zA-Zа-яА-ЯёЁ0-9 ]/g, "_").trim()}.pdf`;
    pdf.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}

export async function fetchBackups() {
  const res = await authFetch(`${API_BASE}/api/admin/backups`);
  if (!res.ok) throw new Error("Ошибка загрузки бекапов");
  const data = await res.json();
  return data.backups || [];
}

export async function createBackup(note = "") {
  const res = await authFetch(`${API_BASE}/api/admin/backups`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка создания бекапа");
  }
  return res.json();
}

export async function restoreBackup(backupId) {
  const res = await authFetch(`${API_BASE}/api/admin/backups/${backupId}/restore`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка восстановления");
  }
  return res.json();
}

export async function deleteBackup(backupId) {
  const res = await authFetch(`${API_BASE}/api/admin/backups/${backupId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Ошибка удаления бекапа");
  }
  return res.json();
}

export async function ragSearch(query, topK = 5, searchType = "hybrid") {
  const res = await authFetch(`${API_BASE}/api/rag/search`, {
    method: "POST",
    body: JSON.stringify({ query, top_k: topK, search_type: searchType }),
  });
  if (!res.ok) return { results: [], count: 0 };
  return res.json();
}

export async function ragStatus() {
  const res = await authFetch(`${API_BASE}/api/rag/status`);
  if (!res.ok) return null;
  return res.json();
}

export async function ragReindex() {
  const res = await authFetch(`${API_BASE}/api/rag/reindex`, { method: "POST" });
  if (!res.ok) throw new Error("Ошибка переиндексации");
  return res.json();
}

export async function ragIndexDocument(documentId) {
  const res = await authFetch(`${API_BASE}/api/rag/index`, {
    method: "POST",
    body: JSON.stringify({ document_id: documentId }),
  });
  if (!res.ok) throw new Error("Ошибка индексации");
  return res.json();
}

export async function analyzeDocument(documentId, model = "qwen3:4b") {
  const res = await authFetch(`${API_BASE}/api/analytics/analyze`, {
    method: "POST",
    body: JSON.stringify({ document_id: documentId, model }),
  });
  if (!res.ok) throw new Error("Ошибка анализа");
  return res.json();
}

export async function getAnalyticsDashboard() {
  const res = await authFetch(`${API_BASE}/api/analytics/dashboard`);
  if (!res.ok) return null;
  return res.json();
}

export async function getDocumentAnalytics(docId) {
  const res = await authFetch(`${API_BASE}/api/analytics/document/${docId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function generateDocSummary(documentId, model = "qwen3:4b") {
  const res = await authFetch(`${API_BASE}/api/analytics/summary`, {
    method: "POST",
    body: JSON.stringify({ document_id: documentId, model }),
  });
  if (!res.ok) throw new Error("Ошибка генерации");
  return res.json();
}

export async function getDocumentEntities(docId) {
  const res = await authFetch(`${API_BASE}/api/analytics/entities/${docId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function getAllTags() {
  const res = await authFetch(`${API_BASE}/api/analytics/tags`);
  if (!res.ok) return { tags: [] };
  return res.json();
}

export async function getDocumentTimeline() {
  const res = await authFetch(`${API_BASE}/api/analytics/timeline`);
  if (!res.ok) return { timeline: [] };
  return res.json();
}

export async function getKnowledgeGraph() {
  const res = await authFetch(`${API_BASE}/api/analytics/knowledge-graph`);
  if (!res.ok) return { nodes: [], edges: [] };
  return res.json();
}

export async function getOcrStatus() {
  const res = await authFetch(`${API_BASE}/api/analytics/ocr-status`);
  if (!res.ok) return { available: false };
  return res.json();
}

export async function getNotifications() {
  try {
    const res = await authFetch(`${API_BASE}/api/notifications`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.notifications || [];
  } catch {
    return [];
  }
}

export async function markNotificationRead(notifId) {
  await authFetch(`${API_BASE}/api/notifications/${notifId}/read`, { method: "POST" });
}
