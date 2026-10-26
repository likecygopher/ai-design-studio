"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Ellipsis, Film, LayoutTemplate, PanelTop, SwatchBook } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "@/src/i18n/I18nProvider";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  reply?: string;
  error?: string;
  navigation?: {
    href: string;
    label: string;
  };
};

const shortcuts = [
  { href: "/pop", label: "POP Design", icon: PanelTop },
  { href: "/pdp", label: "PDP Builder", icon: LayoutTemplate },
  { href: "/style-transfer", label: "Style Transfer", icon: SwatchBook },
  { href: "/product-video", label: "Product Video", icon: Film }
] as const;

export function CoverChat() {
  const { t } = useI18n();
  const router = useRouter();
  const historyEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [messages, pending]);

  const submitMessage = async () => {
    const message = input.trim();
    if (!message || pending) {
      return;
    }

    const history = messages.slice(-10);
    setInput("");
    setMessages((current) => [...current, { role: "user", content: message }]);
    setPending(true);

    let failureMessage = /[\u3400-\u9fff]/u.test(message)
      ? t("助手暂时不可用，请稍后再试。")
      : "The assistant is temporarily unavailable. Please try again.";

    try {
      const response = await fetch("/api/cover-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history })
      });
      const payload = (await response.json().catch(() => ({}))) as ChatResponse;
      if (!response.ok || !payload.reply) {
        failureMessage = payload.error || failureMessage;
        throw new Error(failureMessage);
      }

      setMessages((current) => [
        ...current,
        { role: "assistant", content: payload.reply as string }
      ]);
      if (payload.navigation?.href) {
        router.push(payload.navigation.href);
      }
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: failureMessage }
      ]);
    } finally {
      setPending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitMessage();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  };

  return (
    <div className="cover-chat-boundary" id="agent">
      <section aria-label="AI creative assistant" className="cover-chat-panel">
        <h2>Tell us... what would you like to create?</h2>

        {messages.length || pending ? (
          <div aria-live="polite" className="cover-chat-history" role="log">
            {messages.map((message, index) => (
              <p className={`cover-chat-message cover-chat-message-${message.role}`} key={index}>
                {message.content}
              </p>
            ))}
            {pending ? (
              <p className="cover-chat-message cover-chat-message-assistant cover-chat-thinking">
                Thinking
                <span aria-hidden="true">...</span>
              </p>
            ) : null}
            <div ref={historyEndRef} />
          </div>
        ) : null}

        <form className="cover-chat-form" onSubmit={handleSubmit}>
          <label className="cover-chat-composer">
            <span className="cover-chat-label">Message the creative assistant</span>
            <textarea
              aria-label="Message the creative assistant"
              disabled={pending}
              maxLength={2_000}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to create, or ask to open a design tool..."
              rows={3}
              value={input}
            />
            <button
              aria-label="Send message"
              className="cover-chat-send"
              disabled={pending || !input.trim()}
              type="submit"
            >
              <ArrowUp aria-hidden="true" size={24} strokeWidth={2.2} />
            </button>
          </label>
        </form>

        <nav aria-label="Popular design tools" className="cover-chat-shortcuts">
          {shortcuts.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link href={shortcut.href} key={shortcut.href}>
                <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{shortcut.label}</span>
              </Link>
            );
          })}
          <button aria-label="More tools" className="cover-chat-more" disabled type="button">
            <Ellipsis aria-hidden="true" size={18} />
          </button>
        </nav>
      </section>
    </div>
  );
}
