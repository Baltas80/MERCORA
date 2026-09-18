const products = [
  { id: "p1", title: "ThinkPad X1 Carbon", category: "Computing", condition: "Very good", seller: "northstar", price: 320 },
  { id: "p2", title: "Mirrorless Camera Body", category: "Cameras", condition: "Good", seller: "silverframe", price: 410 },
  { id: "p3", title: "Vintage Hi-Fi Receiver", category: "Electronics", condition: "Good", seller: "analog-works", price: 185 },
  { id: "p4", title: "Mechanical Workshop Set", category: "Tools", condition: "Like new", seller: "forge_12", price: 95 },
  { id: "p5", title: "Compact Coffee Grinder", category: "Home", condition: "Very good", seller: "copperline", price: 70 },
  { id: "p6", title: "Film Camera Kit", category: "Cameras", condition: "Excellent", seller: "grainlab", price: 260 },
  { id: "p7", title: "Retro Console Bundle", category: "Collectibles", condition: "Good", seller: "pixelvault", price: 145 },
  { id: "p8", title: "Heavy Cotton Jacket", category: "Clothing", condition: "Very good", seller: "morrow", price: 80 }
];

const state = { cart: [] };
const productGrid = document.querySelector("#productGrid");
const resultCount = document.querySelector("#resultCount");
const cartCount = document.querySelector("#cartCount");
const cartDialog = document.querySelector("#cartDialog");
const cartItems = document.querySelector("#cartItems");
const cartTotal = document.querySelector("#cartTotal");

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

function renderProducts(list) {
  resultCount.textContent = `${list.length} listings`;
  productGrid.replaceChildren();
  for (const product of list) {
    const card = document.createElement("article");
    card.className = "product";
    card.innerHTML = `
      <div class="product-art" aria-hidden="true">MERCORA</div>
      <div class="product-body">
        <h3 class="product-title">${escapeHtml(product.title)}</h3>
        <div class="product-meta">${escapeHtml(product.category)} · ${escapeHtml(product.condition)}<br>Seller: ${escapeHtml(product.seller)}</div>
        <div class="product-footer">
          <span class="price">€${product.price.toLocaleString("en-IE")}</span>
          <button class="add" data-id="${product.id}" type="button">ADD</button>
        </div>
      </div>`;
    productGrid.appendChild(card);
  }
}

function renderCart() {
  cartCount.textContent = String(state.cart.length);
  cartItems.replaceChildren();
  let total = 0;
  for (const item of state.cart) {
    total += item.price;
    const line = document.createElement("div");
    line.className = "cart-line";
    line.innerHTML = `<span>${escapeHtml(item.title)}</span><strong>€${item.price}</strong>`;
    cartItems.appendChild(line);
  }
  cartTotal.textContent = `€${total.toLocaleString("en-IE")}`;
  if (!state.cart.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Your cart is empty.";
    cartItems.appendChild(empty);
  }
}

productGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  const product = products.find((item) => item.id === button.dataset.id);
  if (product) state.cart.push(product);
  renderCart();
});

document.querySelector("#cartButton").addEventListener("click", () => {
  renderCart();
  cartDialog.showModal();
});
document.querySelector("#closeCart").addEventListener("click", () => cartDialog.close());
document.querySelector("#checkoutButton").addEventListener("click", () => {
  window.location.hash = "checkout";
  cartDialog.close();
  window.alert("Checkout UI will be connected to the audited payment service in a later phase.");
});

document.querySelector("#searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const q = document.querySelector("#searchInput").value.trim().toLowerCase();
  const filtered = q ? products.filter((item) => [item.title, item.category, item.condition, item.seller].some((value) => value.toLowerCase().includes(q))) : products;
  renderProducts(filtered);
});

document.querySelectorAll(".category").forEach((button) => {
  button.addEventListener("click", () => renderProducts(products.filter((item) => item.category === button.dataset.category)));
});

renderProducts(products);
renderCart();
