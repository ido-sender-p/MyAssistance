export const UI_HTML = `<!DOCTYPE html>
<html lang="he">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Assistant</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0c0c0e;
    --surface: #18181b;
    --surface2: #1f1f23;
    --border: #27272a;
    --text: #e4e4e7;
    --muted: #52525b;
    --user-bg: #4f46e5;
    --user-text: #fff;
    --accent: #6366f1;
    --radius: 16px;
  }

  html, body { height: 100%; }

  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100vh;
    overflow: hidden;
  }

  header {
    width: 100%;
    max-width: 720px;
    padding: 20px 24px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--border);
  }

  .logo {
    width: 28px; height: 28px;
    background: var(--accent);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px;
  }

  header h1 {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .model-badge {
    margin-left: auto;
    font-size: 11px;
    color: var(--muted);
    background: var(--surface);
    padding: 3px 8px;
    border-radius: 20px;
    border: 1px solid var(--border);
  }

  #messages {
    flex: 1;
    width: 100%;
    max-width: 720px;
    overflow-y: auto;
    padding: 24px 24px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    scroll-behavior: smooth;
  }

  #messages::-webkit-scrollbar { width: 4px; }
  #messages::-webkit-scrollbar-track { background: transparent; }
  #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .msg {
    display: flex;
    flex-direction: column;
    max-width: 82%;
    animation: fadeUp 0.18s ease;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .msg.user { align-self: flex-end; align-items: flex-end; }
  .msg.assistant { align-self: flex-start; align-items: flex-start; }

  .bubble {
    padding: 10px 14px;
    border-radius: var(--radius);
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg.user .bubble {
    background: var(--user-bg);
    color: var(--user-text);
    border-bottom-right-radius: 4px;
  }

  .msg.assistant .bubble {
    background: var(--surface);
    color: var(--text);
    border-bottom-left-radius: 4px;
    border: 1px solid var(--border);
  }

  .typing .bubble {
    display: flex;
    gap: 5px;
    align-items: center;
    padding: 12px 16px;
  }

  .dot {
    width: 6px; height: 6px;
    background: var(--muted);
    border-radius: 50%;
    animation: bounce 1.2s ease infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(1); opacity: 0.4; }
    40% { transform: scale(1.2); opacity: 1; }
  }

  .input-area {
    width: 100%;
    max-width: 720px;
    padding: 16px 24px 24px;
  }

  .input-wrap {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 10px 10px 16px;
    transition: border-color 0.15s;
  }

  .input-wrap:focus-within {
    border-color: var(--accent);
  }

  textarea {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    resize: none;
    max-height: 160px;
    min-height: 22px;
    height: 22px;
  }

  textarea::placeholder { color: var(--muted); }

  button#send {
    width: 34px; height: 34px;
    background: var(--accent);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: opacity 0.15s, transform 0.1s;
  }

  button#send:hover { opacity: 0.85; }
  button#send:active { transform: scale(0.92); }
  button#send:disabled { opacity: 0.3; cursor: default; }

  button#send svg { display: block; }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--muted);
    font-size: 14px;
    padding-bottom: 40px;
  }

  .empty-icon {
    width: 48px; height: 48px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px;
  }
</style>
</head>
<body>

<header>
  <div class="logo">✦</div>
  <h1>Assistant</h1>
  <span class="model-badge" id="modelBadge">Workers AI</span>
</header>

<div id="messages">
  <div class="empty-state" id="emptyState">
    <div class="empty-icon">✦</div>
    <span>איך אפשר לעזור?</span>
  </div>
</div>

<div class="input-area">
  <div class="input-wrap">
    <textarea id="input" placeholder="כתוב הודעה..." rows="1"></textarea>
    <button id="send" disabled>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M14 8L2 2l2.5 6L2 14l12-6z" fill="white"/>
      </svg>
    </button>
  </div>
</div>

<script>
  const messagesEl = document.getElementById('messages');
  const inputEl    = document.getElementById('input');
  const sendBtn    = document.getElementById('send');
  const emptyState = document.getElementById('emptyState');

  let sessionId = localStorage.getItem('session_id') || null;
  let busy = false;

  inputEl.addEventListener('input', () => {
    inputEl.style.height = '22px';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
    sendBtn.disabled = !inputEl.value.trim() || busy;
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) send();
    }
  });

  sendBtn.addEventListener('click', send);

  function addMsg(role, text) {
    if (emptyState) emptyState.remove();
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function addTyping() {
    if (emptyState) emptyState.remove();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant typing';
    wrap.id = 'typing';
    wrap.innerHTML = '<div class="bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeTyping() {
    document.getElementById('typing')?.remove();
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text || busy) return;

    busy = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = '22px';

    addMsg('user', text);
    addTyping();

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (sessionId) headers['X-Session-Id'] = sessionId;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: text }),
      });

      const data = await res.json();
      removeTyping();

      if (data.sessionId) {
        sessionId = data.sessionId;
        localStorage.setItem('session_id', sessionId);
      }

      addMsg('assistant', data.reply || data.error || 'שגיאה לא ידועה');
    } catch (err) {
      removeTyping();
      addMsg('assistant', 'שגיאת תקשורת. נסה שוב.');
    }

    busy = false;
    sendBtn.disabled = !inputEl.value.trim();
    inputEl.focus();
  }

  inputEl.focus();
</script>
</body>
</html>`;
