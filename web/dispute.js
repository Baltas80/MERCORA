const button = document.querySelector("#openDispute");
const message = document.querySelector("#message");
button.addEventListener("click", () => {
  const description = document.querySelector("#description").value.trim();
  if (description.length < 10) {
    message.textContent = "Describe the issue with enough detail for review.";
    return;
  }
  message.textContent = "The dispute request must be submitted through the authenticated MERCORA API.";
});
