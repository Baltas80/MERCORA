const nav = document.querySelectorAll(".admin-nav");
const content = document.querySelector("#adminContent");

const sections = {
  overview: ["Overview", "Global operational status, security alerts and queue health."],
  users: ["Users", "Account state, sessions, freezes, disables and security events."],
  sellers: ["Sellers & stores", "Store state, activation source, eligibility, disputes and risk posture."],
  sales: ["Sales & orders", "Orders, inventory, delivery state and buyer/seller protections."],
  payments: ["Payments", "Payment intents, verification state, confirmations and reconciliation."],
  wallets: ["Wallets", "Custody-account metadata and wallet-service status. Private keys are never exposed."],
  escrow: ["Escrow", "Funds held, release/refund state and guarded operations."],
  points: ["Points & levels", "Point ledger, level thresholds, rewards, deductions and eligibility."],
  payouts: ["Payout modes", "Standard escrow, limited early release and advance payout requests."],
  moderation: ["Moderation", "Reports, blocked listings, seller actions and review queues."],
  disputes: ["Disputes", "Open cases, evidence, mediation, decisions, appeals and financial outcome status."],
  promos: ["Promotion codes", "Create, revoke and inspect seller-store promotion codes."],
  audit: ["Audit log", "Administrative decisions and security-relevant actions."],
  emergency: ["Emergency controls", "Fail-closed freeze/recovery workflow with independent authorization."]
};

for (const button of nav) {
  button.addEventListener("click", () => {
    for (const item of nav) item.classList.toggle("active", item === button);
    const [title, description] = sections[button.dataset.section];
    content.innerHTML = "<h2></h2><p class=\"muted\"></p>";
    content.querySelector("h2").textContent = title;
    content.querySelector("p").textContent = description;
  });
}
