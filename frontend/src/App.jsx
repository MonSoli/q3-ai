import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import Message from "./components/Message";
import InputArea from "./components/InputArea";
import Settings from "./components/Settings";
import AuthPage from "./components/AuthPage";
import AdminPanel from "./components/AdminPanel";
import UserProfile from "./components/UserProfile";
import SearchModal from "./components/SearchModal";
import KnowledgeBase from "./components/KnowledgeBase";
import { useAuth } from "./contexts/AuthContext";
import { useLang } from "./contexts/LangContext";
import {
  fetchModels,
  streamChat,
  warmupModel,
  fetchChats,
  createChat,
  fetchChat,
  deleteChat as deleteChatApi,
  renameChat,
  saveMessage,
  fetchSettings,
  updateSettings,
  importChats,
  checkHealth,
  exportChatToPdf,
  generateChatTitle,
  sortAndUploadFiles,
} from "./utils/api";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.entry";
import mammoth from "mammoth";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function quickTitle(text) {
  const clean = text.replace(/[^\wа-яёА-ЯЁ\s]/gi, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 5) return words.join(" ") || "Новый чат";
  return words.slice(0, 5).join(" ");
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "xml", "html", "htm", "css", "js", "jsx",
  "ts", "tsx", "py", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs",
  "rb", "php", "sh", "bash", "zsh", "bat", "cmd", "ps1", "sql", "yaml",
  "yml", "toml", "ini", "cfg", "conf", "log", "env", "gitignore",
  "dockerfile", "makefile", "cmake", "gradle", "swift", "kt", "scala",
  "r", "m", "lua", "pl", "tex", "bib", "svg", "vue", "svelte",
]);

function isTextFile(filename) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const name = filename.toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (["makefile", "dockerfile", "rakefile", "gemfile", "procfile"].includes(name)) return true;
  return false;
}

function isPdf(filename) {
  return filename.toLowerCase().endsWith(".pdf");
}

function isDocx(filename) {
  return filename.toLowerCase().endsWith(".docx");
}

function isDoc(filename) {
  return filename.toLowerCase().endsWith(".doc");
}

async function extractDocxText(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || "[DOCX файл не содержит текста]";
  } catch (err) {
    return `[Ошибка извлечения текста из DOCX: ${err.message}]`;
  }
}

async function extractPdfText(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      if (pageText.trim()) {
        pages.push(`[Страница ${i}]\n${pageText}`);
      }
    }
    return pages.join("\n\n") || "[PDF файл не содержит текста]";
  } catch (err) {
    return `[Ошибка извлечения текста из PDF: ${err.message}]`;
  }
}

async function readFileAsText(file) {
  if (isPdf(file.name)) {
    const content = await extractPdfText(file);
    return { name: file.name, content, type: "pdf" };
  }

  if (isDocx(file.name)) {
    const content = await extractDocxText(file);
    return { name: file.name, content, type: "docx" };
  }

  if (isDoc(file.name)) {
    return {
      name: file.name,
      content: `[Формат .doc не поддерживается. Пожалуйста, сохраните файл в формате .docx]`,
      type: "unsupported",
    };
  }

  return new Promise((resolve) => {
    if (isTextFile(file.name)) {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, content: reader.result, type: "text" });
      reader.onerror = () => resolve({ name: file.name, content: "[Ошибка чтения файла]", type: "error" });
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name,
        content: `[Бинарный файл: ${file.name}, размер: ${(file.size / 1024).toFixed(1)} КБ, тип: ${file.type || "unknown"}]`,
        type: "binary",
      });
      reader.onerror = () => resolve({ name: file.name, content: "[Ошибка чтения файла]", type: "error" });
      reader.readAsDataURL(file);
    }
  });
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("qwen3_theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("qwen3_theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}

export default function App() {
  const { user, loading: authLoading, logout } = useAuth();
  const { t, lang } = useLang();
  const { theme, toggleTheme } = useTheme();

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [activeMessages, setActiveMessages] = useState([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("qwen3:4b");
  const [temperature, setTemperature] = useState(0.7);
  const [thinking, setThinking] = useState(true);
  const [numCtx, setNumCtx] = useState(4096);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("qwen3_sidebar_collapsed") === "true");
  const [showMigration, setShowMigration] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [databaseOpen, setDatabaseOpen] = useState(false);
  const [activeToolCall, setActiveToolCall] = useState(null);
  const [ollamaStatus, setOllamaStatus] = useState("checking");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  const dragGlobalCounter = useRef(0);

  const isMobile = useIsMobile();
  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);
  const loadedChatsRef = useRef(new Set());
  const scrollTimeoutRef = useRef(null);

  const SUGGESTIONS = useMemo(() => [
    { title: t("sugCompare"), desc: t("sugCompareDesc"), icon: "compare" },
    { title: t("sugSort"), desc: t("sugSortDesc"), icon: "sort" },
    { title: t("sugAnalyze"), desc: t("sugAnalyzeDesc"), icon: "analyze" },
    { title: t("sugSearch"), desc: t("sugSearchDesc"), icon: "search" },
  ], [t, lang]);

  useEffect(() => {
    if (!user) return;

    const check = async () => {
      const data = await checkHealth();
      setOllamaStatus(data.ollama === "connected" ? "connected" : "disconnected");
    };

    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!user || databaseOpen) return;
    const handleDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragGlobalCounter.current++;
      if (e.dataTransfer.types.includes("Files")) {
        setIsDraggingGlobal(true);
      }
    };
    const handleDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragGlobalCounter.current--;
      if (dragGlobalCounter.current === 0) {
        setIsDraggingGlobal(false);
      }
    };
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingGlobal(false);
      dragGlobalCounter.current = 0;
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        setFiles((prev) => [...(prev || []), ...droppedFiles]);
      }
    };
    const el = document.documentElement;
    el.addEventListener("dragenter", handleDragEnter);
    el.addEventListener("dragleave", handleDragLeave);
    el.addEventListener("dragover", handleDragOver);
    el.addEventListener("drop", handleDrop);
    return () => {
      el.removeEventListener("dragenter", handleDragEnter);
      el.removeEventListener("dragleave", handleDragLeave);
      el.removeEventListener("dragover", handleDragOver);
      el.removeEventListener("drop", handleDrop);
    };
  }, [user, databaseOpen]);

  const handleNewChatRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") {
          e.target.blur();
          setSettingsOpen(false);
          setProfileOpen(false);
          setAdminPanelOpen(false);
          setSearchOpen(false);
          setDeleteConfirmId(null);
        }
        return;
      }

      if (e.altKey && e.code === "KeyN") {
        e.preventDefault();
        e.stopPropagation();
        handleNewChatRef.current?.();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyF") {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSettingsOpen(false);
        setProfileOpen(false);
        setAdminPanelOpen(false);
        setSearchOpen(false);
        setDeleteConfirmId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  useEffect(() => {
    if (!user) return;

    fetchChats().then((chatList) => {
      setChats(chatList);
      if (chatList.length > 0) {
        setActiveChatId(chatList[0].id);
      }
    });

    fetchSettings().then((s) => {
      if (s) {
        setModel(s.model || "qwen3:4b");
        setTemperature(s.temperature ?? 0.7);
        setThinking(s.thinking ?? true);
        setNumCtx(s.num_ctx ?? 4096);
      }
    });

    try {
      const existing = JSON.parse(localStorage.getItem("qwen3_chats") || "[]");
      if (existing.length > 0) {
        setShowMigration(true);
      }
    } catch (err) {
      console.warn("Failed to check migration data:", err);
    }
  }, [user]);

  useEffect(() => {
    if (!activeChatId || !user) {
      setActiveMessages([]);
      return;
    }

    if (loadedChatsRef.current.has(activeChatId)) return;

    fetchChat(activeChatId).then((chatData) => {
      loadedChatsRef.current.add(activeChatId);
      setActiveMessages(
        chatData.messages.map((m) => ({
          role: m.role,
          content: m.content,
          displayContent: m.display_content,
          files: m.files,
        }))
      );
    }).catch(() => {});
  }, [activeChatId, user]);

  const modelRef = useRef(model);
  modelRef.current = model;
  useEffect(() => {
    fetchModels().then((m) => {
      setModels(m);
      const currentModel = modelRef.current;
      if (m.length > 0 && !m.includes(currentModel)) {
        setModel(m[0]);
      }
      const targetModel = m.includes(currentModel) ? currentModel : m[0];
      if (targetModel) warmupModel(targetModel);
    });
  }, []);

  useEffect(() => {
    if (scrollTimeoutRef.current) return;
    scrollTimeoutRef.current = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      scrollTimeoutRef.current = null;
    }, 100);
  }, [activeMessages]);

  const handleMigrationImport = useCallback(async () => {
    try {
      setMigrating(true);
      const existing = JSON.parse(localStorage.getItem("qwen3_chats") || "[]");
      if (existing.length > 0) {
        await importChats(existing);
        localStorage.removeItem("qwen3_chats");
        const chatList = await fetchChats();
        setChats(chatList);
        if (chatList.length > 0) setActiveChatId(chatList[0].id);
      }
    } catch (err) {
      console.error("Migration import failed:", err);
    }
    setMigrating(false);
    setShowMigration(false);
  }, []);

  const handleMigrationSkip = useCallback(() => {
    setShowMigration(false);
  }, []);

  const handleNewChat = useCallback(async () => {
    try {
      const chat = await createChat(t("newChat"));
      setChats((prev) => [{ ...chat, message_count: 0 }, ...prev]);
      setActiveChatId(chat.id);
      setActiveMessages([]);
      loadedChatsRef.current.add(chat.id);
      setInput("");
      setFiles([]);
      if (isMobile) setSidebarOpen(false);
    } catch (err) {
      console.error("Failed to create new chat:", err);
    }
  }, [isMobile, t]);
  handleNewChatRef.current = handleNewChat;

  const handleSelectChat = useCallback((id) => {
    setActiveChatId(id);
    loadedChatsRef.current.delete(id);
    setInput("");
    setFiles([]);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleDeleteChat = useCallback((id) => {
    setDeleteConfirmId(id);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    const id = deleteConfirmId;
    if (!id) return;
    try {
      await deleteChatApi(id);
      loadedChatsRef.current.delete(id);
      setChats((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (id === activeChatId) {
          const newActive = next.length > 0 ? next[0].id : null;
          setActiveChatId(newActive);
          if (!newActive) setActiveMessages([]);
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
    setDeleteConfirmId(null);
  }, [deleteConfirmId, activeChatId]);

  const handleRenameChat = useCallback(async (id, newTitle) => {
    try {
      await renameChat(id, newTitle);
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, title: newTitle } : c));
    } catch (err) {
      console.error("Failed to rename chat:", err);
    }
  }, []);

  const typeMessageAnimated = useCallback((fullText, onComplete) => {
    let index = 0;
    setActiveMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    setIsGenerating(true);

    const interval = setInterval(() => {
      index++;
      const chunk = fullText.slice(0, index);
      setActiveMessages((prev) => {
        const msgs = [...prev];
        msgs[msgs.length - 1] = { role: "assistant", content: chunk };
        return msgs;
      });
      if (index >= fullText.length) {
        clearInterval(interval);
        setIsGenerating(false);
        onComplete?.();
      }
    }, 15);

    return () => clearInterval(interval);
  }, []);

  const handleQuickAction = useCallback(async (icon) => {
    const titleMap = {
      compare: t("sugCompare"),
      sort: t("sugSort"),
      analyze: t("sugAnalyze"),
      search: t("sugSearch"),
    };
    const botResponseMap = {
      compare: t("compareAskFiles"),
      sort: t("sortAskFiles"),
      analyze: t("analyzeAskFile"),
      search: t("searchAskQuery"),
    };

    const title = titleMap[icon];
    const botText = botResponseMap[icon];
    const userMessage = { role: "user", content: title, displayContent: title, files: [] };

    let chatId = activeChatId;

    if (!chatId) {
      try {
        const chat = await createChat(title);
        chatId = chat.id;
        setChats((prev) => [{ ...chat, message_count: 0 }, ...prev]);
        setActiveChatId(chatId);
        loadedChatsRef.current.add(chatId);
      } catch (err) {
        console.error("Failed to create quick action chat:", err);
        return;
      }
    }

    try {
      await saveMessage(chatId, { role: "user", content: title, display_content: title, files: [] });
    } catch (err) {
      console.error("Failed to save user message:", err);
    }

    setActiveMessages((prev) => [...prev, userMessage]);
    setInput("");
    setFiles([]);

    typeMessageAnimated(botText, async () => {
      try {
        await saveMessage(chatId, { role: "assistant", content: botText });
      } catch (err) {
        console.error("Failed to save bot message:", err);
      }
    });

    generateChatTitle(chatId, title, model).then((aiTitle) => {
      if (aiTitle) {
        setChats((prev) =>
          prev.map((c) => (c.id === chatId ? { ...c, title: aiTitle } : c))
        );
      }
    });
  }, [activeChatId, model, t, typeMessageAnimated]);

  const handleSuggestionClick = useCallback((text, icon) => {
    handleQuickAction(icon);
  }, [handleQuickAction]);

  const handleExportPdf = useCallback(() => {
    if (!activeChatId || activeMessages.length === 0) return;
    const chat = chats.find((c) => c.id === activeChatId);
    exportChatToPdf(chat?.title || t("newChat"), activeMessages);
  }, [activeChatId, activeMessages, chats, t]);

  const sendingRef = useRef(false);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && (!files || files.length === 0)) || isGenerating) return;
    if (sendingRef.current) return;
    sendingRef.current = true;

    let fileContents = [];
    if (files.length > 0) {
      fileContents = await Promise.all(files.map(readFileAsText));
    }

    let messageContent = input.trim();

    const lastMsg = activeMessages.length > 0 ? activeMessages[activeMessages.length - 1] : null;
    let quickActionFlow = null;
    if (lastMsg && lastMsg.role === "assistant") {
      if (lastMsg.content === t("compareAskFiles")) quickActionFlow = "compare";
      else if (lastMsg.content === t("sortAskFiles")) quickActionFlow = "sort";
      else if (lastMsg.content === t("analyzeAskFile")) quickActionFlow = "analyze";
      else if (lastMsg.content === t("searchAskQuery")) quickActionFlow = "search";
    }

    if (quickActionFlow === "sort" && files.length > 0) {
      const filesMeta = files.map((f) => ({ name: f.name, size: f.size }));
      const displayText = input.trim() || `[${files.map(f => f.name).join(", ")}]`;
      const userMessage = { role: "user", content: displayText, displayContent: displayText, files: filesMeta };

      let chatId = activeChatId;
      if (!chatId) {
        try {
          const chat = await createChat(t("sugSort"));
          chatId = chat.id;
          setChats((prev) => [{ ...chat, message_count: 0 }, ...prev]);
          setActiveChatId(chatId);
          loadedChatsRef.current.add(chatId);
        } catch (err) {
          sendingRef.current = false;
          return;
        }
      }

      try {
        await saveMessage(chatId, { role: "user", content: displayText, display_content: displayText, files: filesMeta });
      } catch (err) {}

      setActiveMessages((prev) => [...prev, userMessage]);
      setInput("");
      setFiles([]);
      setIsGenerating(true);

      try {
        const sortResult = await sortAndUploadFiles(files);
        let resultText = `**${t("sortDone")}**\n\n`;
        resultText += `${t("sortTotalFiles")}: ${sortResult.total_files}\n`;
        resultText += `${t("sortTotalCategories")}: ${sortResult.total_categories}\n`;
        resultText += `${t("sortFolder")}: 📁 ${sortResult.parent_folder_name}\n\n`;

        for (const [category, filenames] of Object.entries(sortResult.categories)) {
          resultText += `**📂 ${category}** (${filenames.length}):\n`;
          filenames.forEach((fn) => { resultText += `  - ${fn}\n`; });
          resultText += "\n";
        }

        if (sortResult.errors && sortResult.errors.length > 0) {
          resultText += `\n**${t("sortErrors")}:**\n`;
          sortResult.errors.forEach((e) => { resultText += `  - ${e.filename}: ${e.error}\n`; });
        }

        resultText += `\n${t("sortOpenKB")}`;

        typeMessageAnimated(resultText, async () => {
          try {
            await saveMessage(chatId, { role: "assistant", content: resultText });
          } catch (err) {}
        });
      } catch (err) {
        const errorText = `${t("sortError")}: ${err.message}`;
        setActiveMessages((prev) => [...prev, { role: "assistant", content: errorText }]);
        setIsGenerating(false);
        try {
          await saveMessage(chatId, { role: "assistant", content: errorText });
        } catch (e) {}
      }

      setChats((prev) =>
        prev.map((c) => c.id === chatId ? { ...c, message_count: (c.message_count || 0) + 2 } : c)
      );
      sendingRef.current = false;
      return;
    }

    if (fileContents.length > 0) {
      const total = fileContents.length;
      const fileSection = fileContents
        .map((f, idx) => {
          const header = total > 1
            ? `========== ФАЙЛ ${idx + 1} ИЗ ${total}: "${f.name}" ==========`
            : `========== ФАЙЛ: "${f.name}" ==========`;
          const footer = total > 1
            ? `========== КОНЕЦ ФАЙЛА ${idx + 1} ("${f.name}") ==========`
            : `========== КОНЕЦ ФАЙЛА ==========`;
          return `${header}\n${f.content}\n${footer}`;
        })
        .join("\n\n\n");
      if (!messageContent && quickActionFlow === "compare") {
        messageContent = `Пользователь прикрепил ${total} файла(ов) для сравнения.\n\n${fileSection}\n\n${t("compareDefaultPrompt")}`;
      } else if (!messageContent && quickActionFlow === "analyze") {
        messageContent = `Пользователь прикрепил ${total} файл(ов) для анализа.\n\n${fileSection}\n\n${t("analyzeDefaultPrompt")}`;
      } else {
        const userText = messageContent || (total > 1 ? "Проанализируй все прикреплённые файлы." : "Проанализируй прикреплённый файл.");
        messageContent = `Пользователь прикрепил ${total} файл(ов).\n\n${fileSection}\n\n${userText}`;
      }
    }

    const filesMeta = files.map((f) => ({ name: f.name, size: f.size }));
    const displayText = input.trim() || (fileContents.length > 0 ? `[${fileContents.map(f => f.name).join(", ")}]` : "");
    const tempTitle = quickTitle(displayText);
    const userMessage = { role: "user", content: messageContent, displayContent: displayText, files: filesMeta };

    let chatId = activeChatId;
    let isFirstMessage = false;

    if (!chatId) {
      isFirstMessage = true;
      try {
        const chat = await createChat(tempTitle);
        chatId = chat.id;
        setChats((prev) => [{ ...chat, message_count: 0 }, ...prev]);
        setActiveChatId(chatId);
        loadedChatsRef.current.add(chatId);
      } catch (err) {
        console.error("Failed to create chat:", err);
        sendingRef.current = false;
        return;
      }
    } else {
      const chat = chats.find((c) => c.id === chatId);
      if (chat && chat.message_count === 0 && activeMessages.length === 0) {
        isFirstMessage = true;
        setChats((prev) =>
          prev.map((c) => (c.id === chatId ? { ...c, title: tempTitle } : c))
        );
      }
    }

    try {
      await saveMessage(chatId, {
        role: "user",
        content: messageContent,
        display_content: displayText,
        files: filesMeta.map((f) => ({ name: f.name, size: f.size })),
      });
    } catch (err) {
      console.error("Failed to save user message:", err);
    }

    setActiveMessages((prev) => [...prev, userMessage]);
    setInput("");
    setFiles([]);
    setIsGenerating(true);

    if (isFirstMessage) {
      const titleChatId = chatId;
      const titleInput = displayText;
      generateChatTitle(titleChatId, titleInput, model).then((aiTitle) => {
        if (aiTitle) {
          setChats((prev) =>
            prev.map((c) => (c.id === titleChatId ? { ...c, title: aiTitle } : c))
          );
        }
      });
    }

    const assistantMessage = { role: "assistant", content: "" };
    setActiveMessages((prev) => [...prev, assistantMessage]);

    const abortController = new AbortController();
    abortRef.current = abortController;

    const allMessages = [
      ...activeMessages,
      userMessage,
    ].map((m) => ({ role: m.role, content: m.content }));

    let effectiveNumCtx = numCtx;
    if (fileContents.length > 0) {
      const totalChars = messageContent.length;
      const estimatedTokens = Math.ceil(totalChars / 3);
      const needed = estimatedTokens + 4096;
      effectiveNumCtx = Math.max(numCtx, Math.min(needed, 32768));
    }

    try {
      await streamChat({
        messages: allMessages,
        model,
        temperature,
        thinking,
        num_ctx: effectiveNumCtx,
        chatId,
        signal: abortController.signal,
        onToken: (token) => {
          setActiveToolCall(null);
          setActiveMessages((prev) => {
            const msgs = [...prev];
            const last = msgs[msgs.length - 1];
            msgs[msgs.length - 1] = { ...last, content: last.content + token };
            return msgs;
          });
        },
        onToolUse: (toolName) => {
          setActiveToolCall(toolName);
        },
        onDone: () => {},
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        setActiveMessages((prev) => {
          const msgs = [...prev];
          const last = msgs[msgs.length - 1];
          if (!last.content) {
            msgs[msgs.length - 1] = {
              ...last,
              content: t("errorFetch"),
            };
          }
          return msgs;
        });
      }
    } finally {
      setIsGenerating(false);
      setActiveToolCall(null);
      abortRef.current = null;
      sendingRef.current = false;
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId ? { ...c, message_count: (c.message_count || 0) + 2 } : c
        )
      );
    }
  }, [input, files, isGenerating, activeChatId, chats, activeMessages, model, temperature, thinking, numCtx, t]);


  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
  }, []);

  const handleSettingsChange = useCallback((key, value) => {
    const updates = {};
    if (key === "model") {
      setModel(value);
      updates.model = value;
    } else if (key === "temperature") {
      setTemperature(value);
      updates.temperature = value;
    } else if (key === "thinking") {
      setThinking(value);
      updates.thinking = value;
    } else if (key === "num_ctx") {
      setNumCtx(value);
      updates.num_ctx = value;
    }
    updateSettings(updates).catch(() => {});
  }, []);

  if (authLoading) {
    return (
      <div className="app" style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="loading-bg" />
        <div className="loading-screen">
          <div className="loading-logo">Q3</div>
          <div className="loading-spinner-ring" />
          <span className="loading-text">{t("loading")}</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  if (databaseOpen) {
    return (
      <KnowledgeBase
        isFullPage={true}
        onClose={() => setDatabaseOpen(false)}
      />
    );
  }

  const getSuggestionIcon = (type) => {
    switch (type) {
      case "compare":
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
        );
      case "sort":
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 6h18M3 12h12M3 18h6" />
          </svg>
        );
      case "analyze":
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <path d="M16 13H8M16 17H8M10 9H8" />
          </svg>
        );
      case "search":
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        );
      default:
        return null;
    }
  };

  const activeChat = chats.find((c) => c.id === activeChatId);

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenAdmin={() => setAdminPanelOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenDatabase={() => setDatabaseOpen(true)}
        onLogout={logout}
        user={user}
        isOpen={sidebarOpen}
        isMobile={isMobile}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => {
          setSidebarCollapsed((prev) => {
            localStorage.setItem("qwen3_sidebar_collapsed", !prev);
            return !prev;
          });
        }}
      />

      {isMobile && sidebarOpen && (
        <div className="sidebar-overlay visible" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="main-area">
        {isDraggingGlobal && (
          <div className="global-drop-overlay">
            <div className="global-drop-overlay-content">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>{t("dragDropHint")}</span>
            </div>
          </div>
        )}
        <div className="main-header">
          {isMobile && (
            <button className="hamburger-btn" onClick={() => setSidebarOpen(true)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
          )}
          <span className="main-header-title">
            <span className="model-badge">Q3 AI</span>
            <span className={`ollama-status ${ollamaStatus}`} title={
              ollamaStatus === "connected" ? t("ollamaConnected") :
              ollamaStatus === "disconnected" ? t("ollamaDisconnected") : t("ollamaChecking")
            }>
              <span className="ollama-dot" />
              {ollamaStatus === "disconnected" && <span className="ollama-label">{t("ollamaOffline")}</span>}
            </span>
          </span>
          <div className="main-header-actions">
            <button className="header-action-btn" onClick={() => setSearchOpen(true)} title={t("search") + " (Ctrl+F)"}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </button>
            {activeMessages.length > 0 && (
              <button className="header-action-btn" onClick={handleExportPdf} title={t("exportPdf")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <path d="M12 18v-6M9 15l3 3 3-3" />
                </svg>
              </button>
            )}
            <button className="header-action-btn theme-toggle" onClick={toggleTheme} title={theme === "dark" ? t("lightTheme") : t("darkTheme")}>
              {theme === "dark" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="messages-container">
          {activeMessages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-header">
                <div className="empty-logo">
                  <span>Q3</span>
                </div>
                <h2>{t("emptyTitle")}</h2>
                <p>{t("emptySubtitle")}</p>
              </div>
              <div className="suggestion-cards">
                {SUGGESTIONS.map((s, i) => (
                  <div
                    key={i}
                    className="suggestion-card"
                    onClick={() => handleSuggestionClick(s.title, s.icon)}
                  >
                    <div className="suggestion-icon">{getSuggestionIcon(s.icon)}</div>
                    <div className="suggestion-text">
                      <div className="suggestion-card-title">{s.title}</div>
                      <div className="suggestion-card-desc">{s.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="shortcuts-hint">
                <span><kbd>Alt</kbd>+<kbd>N</kbd> {t("shortcutNewChat")}</span>
                <span><kbd>Ctrl</kbd>+<kbd>F</kbd> {t("shortcutSearch")}</span>
                <span><kbd>Esc</kbd> {t("shortcutClose")}</span>
              </div>
            </div>
          ) : (
            <>
              {activeMessages.map((msg, i) => (
                <Message
                  key={i}
                  role={msg.role}
                  content={msg.displayContent || msg.content}
                  files={msg.files}
                />
              ))}
              {isGenerating && (
                <div className="generating-indicator">
                  <div className="dot-pulse">
                    <span />
                    <span />
                    <span />
                  </div>
                  {activeToolCall
                    ? `${t("aiUsingTool")} ${activeToolCall}...`
                    : t("generating")}
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        <InputArea
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
          isGenerating={isGenerating}
          disabled={false}
          files={files}
          onFilesChange={setFiles}
        />
      </div>

      <Settings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeToggle={toggleTheme}
      />

      <UserProfile
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
      />

      {user?.is_admin && (
        <AdminPanel
          isOpen={adminPanelOpen}
          onClose={() => setAdminPanelOpen(false)}
        />
      )}

      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectChat={handleSelectChat}
      />


      {deleteConfirmId && (
        <div className="confirm-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <h4>{t("deleteChat")}</h4>
            <p>{t("deleteChatConfirm")}</p>
            <div className="confirm-buttons">
              <button className="confirm-cancel" onClick={() => setDeleteConfirmId(null)}>{t("cancel")}</button>
              <button className="confirm-delete" onClick={handleDeleteConfirm}>{t("delete")}</button>
            </div>
          </div>
        </div>
      )}

      {showMigration && (
        <div className="settings-overlay" onClick={handleMigrationSkip}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="settings-header">
              <h3>{t("migrationTitle")}</h3>
            </div>
            <div className="settings-body" style={{ textAlign: "center" }}>
              <p style={{ color: "var(--text-secondary)", marginBottom: 20, fontSize: 14 }}>
                {t("migrationDesc")}
              </p>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button
                  onClick={handleMigrationImport}
                  disabled={migrating}
                  className="btn-primary"
                >
                  {migrating ? t("importing") : t("importBtn")}
                </button>
                <button
                  onClick={handleMigrationSkip}
                  className="btn-ghost"
                >
                  {t("skip")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
