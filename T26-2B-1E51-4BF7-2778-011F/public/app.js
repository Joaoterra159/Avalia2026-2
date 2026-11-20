const loginLink = document.getElementById("discordLoginLink");
const avatar = document.getElementById("discordAvatar");
const userText = document.getElementById("discordUserText");
const logoutButton = document.getElementById("discordLogoutBtn");
const recordForm = document.getElementById("recordForm");
const recordInput = document.getElementById("recordInput");
const sendButton = document.getElementById("sendBtn");
const diagnosticStatus = document.getElementById("diagnosticStatus");
const statusMessage = document.getElementById("statusMessage");
const recordsList = document.getElementById("recordsList");

const loginPrompt = "Entre com Discord para registrar pings e ver seus registros.";
let sessionUser = null;
let d1Connected = false;
let busy = false;

function renderSession() {
  loginLink.hidden = Boolean(sessionUser);
  userText.hidden = !sessionUser;
  userText.textContent = sessionUser ? `Discord: ${sessionUser.username} (${sessionUser.userId})` : "";

  avatar.hidden = !sessionUser?.avatar;
  if (sessionUser?.avatar) {
    avatar.src = sessionUser.avatar;
  } else {
    avatar.removeAttribute("src");
  }

  logoutButton.hidden = !sessionUser;
  logoutButton.disabled = busy;
  recordInput.disabled = sendButton.disabled = busy || !sessionUser || !d1Connected;
}

function renderRecords(entries) {
  recordsList.replaceChildren(...entries.map((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    return item;
  }));
}

async function carregarStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Falha ao consultar o status.");

    const data = await response.json();
    sessionUser = data.sessionUser;
    d1Connected = data.d1Connected;
    const dbStatus = d1Connected ? "D1 conectado." : "D1 indisponível.";
    const oauthStatus = data.discordOAuthConfigured ? "" : " Login do Discord indisponível neste ambiente.";
    diagnosticStatus.textContent = `API online. ${dbStatus}${oauthStatus}`;

    if (!sessionUser) {
      renderRecords([loginPrompt]);
    } else if (!d1Connected) {
      renderRecords(["Os registros estão indisponíveis."]);
    } else if (data.ultimosRegistros.length) {
      renderRecords(data.ultimosRegistros.map((item) =>
        `[${item.created_at || "agora"}] ${item.username} (${item.user_id}): ${item.conteudo}`
      ));
    } else {
      renderRecords(["Você ainda não registrou nenhum ping."]);
    }
  } catch {
    sessionUser = null;
    d1Connected = false;
    diagnosticStatus.textContent = "API serverless indisponível.";
    renderRecords(["Não foi possível consultar os registros."]);
  } finally {
    renderSession();
  }
}

recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const conteudo = recordInput.value.trim();
  if (!conteudo || sendButton.disabled) return;

  busy = true;
  renderSession();
  statusMessage.textContent = "Registrando ping...";
  try {
    const response = await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conteudo }),
    });
    if (response.status === 401) {
      statusMessage.textContent = "Sua sessão expirou. Entre com Discord para registrar o ping.";
      await carregarStatus();
      return;
    }
    if (!response.ok) throw new Error("Falha ao registrar o ping.");

    recordInput.value = "";
    statusMessage.textContent = "Ping registrado no Cloudflare D1.";
    await carregarStatus();
  } catch {
    statusMessage.textContent = "Não foi possível registrar o ping.";
  } finally {
    busy = false;
    renderSession();
  }
});

logoutButton.addEventListener("click", async () => {
  if (busy || !sessionUser) return;

  busy = true;
  renderSession();
  statusMessage.textContent = "Encerrando sessão...";
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Falha ao encerrar a sessão.");

    sessionUser = null;
    recordInput.value = "";
    renderSession();
    renderRecords([loginPrompt]);
    statusMessage.textContent = "Sessão encerrada.";
    await carregarStatus();
  } catch {
    statusMessage.textContent = "Não foi possível encerrar a sessão. Tente novamente.";
  } finally {
    busy = false;
    renderSession();
  }
});

const pageUrl = new URL(window.location.href);
if (pageUrl.searchParams.has("auth_error")) {
  statusMessage.textContent = "Não foi possível entrar com Discord. Tente novamente.";
}
if (pageUrl.searchParams.has("auth_error") || pageUrl.searchParams.has("login")) {
  pageUrl.searchParams.delete("auth_error");
  pageUrl.searchParams.delete("login");
  window.history.replaceState(window.history.state, "", pageUrl);
}

window.addEventListener("pageshow", async (event) => {
  if (!event.persisted || busy) return;
  busy = true;
  renderSession();
  await carregarStatus();
  busy = false;
  renderSession();
});

carregarStatus();
