import React, { useState, useCallback, useMemo, useEffect, useRef, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css";
import { useLang } from "../contexts/LangContext";
import "./Message.css";

function parseThinking(content) {
  const completeMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (completeMatch) {
    const thinking = completeMatch[1].trim();
    const response = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
    return { thinking, response, isThinkingInProgress: false };
  }

  const openMatch = content.match(/<think>([\s\S]*)$/);
  if (openMatch) {
    const thinking = openMatch[1].trim();
    return { thinking, response: "", isThinkingInProgress: true };
  }

  return { thinking: null, response: content, isThinkingInProgress: false };
}

function FileAttachment({ file }) {
  return (
    <div className="file-attachment">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14,2 14,8 20,8" />
      </svg>
      <span className="file-attachment-name">{file.name}</span>
    </div>
  );
}

function CopyButton({ text }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button className={`copy-code-btn ${copied ? "copied" : ""}`} onClick={handleCopy}>
      {copied ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t("copiedCode")}
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          {t("copyCode")}
        </>
      )}
    </button>
  );
}

const markdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    if (!inline && match) {
      const codeText = String(children).replace(/\n$/, "");
      return (
        <div className="code-block-wrapper">
          <div className="code-block-header">
            <span>{match[1]}</span>
            <CopyButton text={codeText} />
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={match[1]}
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: "0 0 8px 8px" }}
            {...props}
          >
            {codeText}
          </SyntaxHighlighter>
        </div>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  td({ children, ...props }) {
    const isEmpty = !children || (Array.isArray(children) && children.every(
      (c) => c === null || c === undefined || (typeof c === "string" && c.trim() === "")
    ));
    return (
      <td {...props}>
        {isEmpty ? <span style={{ color: "var(--text-muted)" }}>—</span> : children}
      </td>
    );
  },
  th({ children, ...props }) {
    const isEmpty = !children || (Array.isArray(children) && children.every(
      (c) => c === null || c === undefined || (typeof c === "string" && c.trim() === "")
    ));
    return (
      <th {...props}>
        {isEmpty ? <span style={{ color: "var(--text-muted)" }}>—</span> : children}
      </th>
    );
  },
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

function ThinkingBlock({ thinking, isThinkingInProgress }) {
  const { t } = useLang();
  const [isOpen, setIsOpen] = useState(isThinkingInProgress);
  const [thinkingTime, setThinkingTime] = useState(0);
  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);
  const wasLiveRef = useRef(false);

  useEffect(() => {
    if (isThinkingInProgress) {
      setIsOpen(true);
      wasLiveRef.current = true;
    }
  }, [isThinkingInProgress]);

  useEffect(() => {
    if (isThinkingInProgress) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
      intervalRef.current = setInterval(() => {
        setThinkingTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isThinkingInProgress]);

  const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds} ${t("sec")}`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins} ${t("min")} ${secs} ${t("sec")}`;
  };

  const thinkingLines = thinking
    ? thinking.split('\n').filter(line => line.trim())
    : [];

  return (
    <div className={`thinking-block ${isThinkingInProgress ? "thinking-active" : ""}`}>
      <button
        className="thinking-toggle"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="thinking-toggle-left">
          {isThinkingInProgress ? (
            <span className="thinking-spinner" />
          ) : (
            <svg className="thinking-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          )}
          <span className="thinking-label">
            {isThinkingInProgress ? t("thinking") : t("thought")}
          </span>
          {(isThinkingInProgress || wasLiveRef.current) && (
            <span className="thinking-time">
              {formatTime(thinkingTime)}
            </span>
          )}
        </div>
        <svg
          className={`thinking-arrow ${isOpen ? "open" : ""}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="thinking-content">
          <div className="thinking-content-inner">
            {thinkingLines.map((line, i) => (
              <p key={i} className="thinking-line">
                <span className="thinking-bullet">•</span>
                {line}
              </p>
            ))}
            {isThinkingInProgress && <span className="thinking-cursor" />}
          </div>
        </div>
      )}
    </div>
  );
}

const Message = memo(function Message({ role, content, files }) {
  const isUser = role === "user";

  const { thinking, response, isThinkingInProgress } = useMemo(() => {
    if (isUser) return { thinking: null, response: content, isThinkingInProgress: false };
    return parseThinking(content);
  }, [content, isUser]);

  return (
    <div className={`message message-enter ${isUser ? "message-user" : "message-assistant"}`}>
      <div className="message-inner">
        {files && files.length > 0 && (
          <div className="message-files">
            {files.map((f, i) => <FileAttachment key={i} file={f} />)}
          </div>
        )}
        <div className="message-content">
          {thinking !== null && (
            <ThinkingBlock
              thinking={thinking}
              isThinkingInProgress={isThinkingInProgress}
            />
          )}
          {response && (
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              components={markdownComponents}
            >
              {response}
            </ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
});

export default Message;
